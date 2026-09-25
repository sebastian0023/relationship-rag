import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import type { StageConfig } from './config.js';
import {
  AiStack,
  ApiStack,
  AuthStack,
  DataStack,
  EdgeStack,
  MessagingStack,
  ObservabilityStack,
} from './stacks.js';

const dev: StageConfig = {
  stage: 'dev',
  coupleId: 'couple-dev',
  deletionProtection: false,
  retainData: false,
  logRetentionDays: 14,
  monthlyBudgetUsd: 15,
  apiRateLimit: 10,
  apiBurstLimit: 20,
  aiReservedConcurrency: 2,
  aiDeadlineMs: 24_000,
  backupRetentionDays: 35,
};
const testStage: StageConfig = { ...dev, stage: 'test', coupleId: 'couple-test' };

describe('privacy infrastructure', () => {
  it('blocks all public access to data buckets and encrypts the table', () => {
    const app = new cdk.App();
    const template = Template.fromStack(new DataStack(app, 'data-test', { config: dev }));

    template.resourceCountIs('AWS::S3::Bucket', 2);
    template.allResourcesProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('disables public self-registration', () => {
    const app = new cdk.App();
    const template = Template.fromStack(
      new AuthStack(app, 'auth-test', { config: dev, frontendDomain: 'frontend.example.test' }),
    );

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Policies: Match.anyValue(),
    });
  });

  it('protects GET /me with a Cognito JWT authorizer and API scope', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'data-test', { config: dev });
    const auth = new AuthStack(app, 'auth-test', {
      config: dev,
      frontendDomain: 'frontend.example.test',
    });
    const messaging = new MessagingStack(app, 'messaging-test', {
      config: dev,
      applicationTable: data.applicationTable,
    });
    const template = Template.fromStack(
      new ApiStack(app, 'api-test', {
        config: dev,
        applicationTable: data.applicationTable,
        userPool: auth.userPool,
        userPoolClient: auth.userPoolClient,
        issuer: auth.issuer,
        frontendDomain: 'frontend.example.test',
        mediaBucket: data.mediaBucket,
        knowledgeBaseId: 'kb-test',
        inferenceProfileArn:
          'arn:aws:bedrock:us-east-1:111111111111:application-inference-profile/test',
        deliveryQueue: messaging.deliveryQueue,
        deliveryDlq: messaging.deadLetterQueue,
        schedulerRole: messaging.schedulerRole,
      }),
    );

    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /me',
      AuthorizationType: 'JWT',
      AuthorizationScopes: ['relationship-rag/access'],
    });
  });

  it('uses retryable, idempotent messaging resources for card delivery', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'data-test', { config: dev });
    const template = Template.fromStack(
      new MessagingStack(app, 'messaging-test', {
        config: dev,
        applicationTable: data.applicationTable,
      }),
    );
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
      VisibilityTimeout: 60,
    });
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(1 minute)' });
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Principal: { Service: 'scheduler.amazonaws.com' } }),
        ]),
      }),
    });
  });

  it('uses an origin access control frontend with HTTPS security headers', () => {
    const app = new cdk.App();
    const template = Template.fromStack(new EdgeStack(app, 'edge-test', { config: dev }));

    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          FrameOptions: Match.objectLike({ FrameOption: 'DENY' }),
        }),
      }),
    });
  });

  it('provisions a private Knowledge Base ingestion path with a single coordinator', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'data-test', { config: dev });
    const template = Template.fromStack(
      new AiStack(app, 'ai-test', {
        config: dev,
        sourceBucket: data.ragSourceBucket,
        applicationTable: data.applicationTable,
      }),
    );

    template.resourceCountIs('AWS::S3Vectors::VectorBucket', 1);
    template.hasResourceProperties('AWS::Bedrock::KnowledgeBase', {
      KnowledgeBaseConfiguration: Match.objectLike({ Type: 'VECTOR' }),
    });
    template.hasResourceProperties('AWS::Bedrock::DataSource', {
      VectorIngestionConfiguration: Match.objectLike({
        ChunkingConfiguration: Match.objectLike({ ChunkingStrategy: 'FIXED_SIZE' }),
      }),
    });
    template.hasResourceProperties('AWS::Lambda::Function', { ReservedConcurrentExecutions: 1 });
    template.hasResourceProperties('AWS::Bedrock::ApplicationInferenceProfile', {
      InferenceProfileName: 'relationship-rag-dev-generation',
      Tags: Match.arrayWith([
        { Key: 'Application', Value: 'relationship-rag' },
        { Key: 'Environment', Value: 'dev' },
      ]),
    });
  });

  it('enables same-region recovery controls outside development', () => {
    const app = new cdk.App();
    const template = Template.fromStack(new DataStack(app, 'data-test', { config: testStage }));

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
        RecoveryPeriodInDays: 35,
      },
    });
    template.allResourcesProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('configures privacy-safe API access logs, throttling, and bounded AI concurrency', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'data-test', { config: dev });
    const auth = new AuthStack(app, 'auth-test', {
      config: dev,
      frontendDomain: 'frontend.example.test',
    });
    const messaging = new MessagingStack(app, 'messaging-test', {
      config: dev,
      applicationTable: data.applicationTable,
    });
    const template = Template.fromStack(
      new ApiStack(app, 'api-test', {
        config: dev,
        applicationTable: data.applicationTable,
        userPool: auth.userPool,
        userPoolClient: auth.userPoolClient,
        issuer: auth.issuer,
        frontendDomain: 'frontend.example.test',
        mediaBucket: data.mediaBucket,
        knowledgeBaseId: 'kb-test',
        inferenceProfileArn:
          'arn:aws:bedrock:us-east-1:111111111111:application-inference-profile/test',
        deliveryQueue: messaging.deliveryQueue,
        deliveryDlq: messaging.deadLetterQueue,
        schedulerRole: messaging.schedulerRole,
      }),
    );

    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      AccessLogSettings: Match.objectLike({ DestinationArn: Match.anyValue() }),
      DefaultRouteSettings: {
        DetailedMetricsEnabled: true,
        ThrottlingBurstLimit: 20,
        ThrottlingRateLimit: 10,
      },
    });
    template.resourcePropertiesCountIs(
      'AWS::Lambda::Function',
      { ReservedConcurrentExecutions: 2 },
      2,
    );
    template.resourcePropertiesCountIs(
      'AWS::Lambda::Function',
      {
        Environment: {
          Variables: Match.objectLike({ AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-proxy-handler' }),
        },
        Layers: Match.anyValue(),
        TracingConfig: { Mode: 'Active' },
      },
      5,
    );
  });

  it('routes alarms and three budget thresholds through an encrypted topic', () => {
    const app = new cdk.App();
    const template = Template.fromStack(
      new ObservabilityStack(app, 'observability-test', {
        config: testStage,
        alertEmail: 'operator@example.test',
      }),
    );

    template.hasResourceProperties('AWS::SNS::Topic', { KmsMasterKeyId: Match.anyValue() });
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'operator@example.test',
    });
    template.hasResourceProperties('AWS::Budgets::Budget', {
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({ Notification: Match.objectLike({ Threshold: 80 }) }),
        Match.objectLike({ Notification: Match.objectLike({ Threshold: 100 }) }),
      ]),
    });
  });
});

describe('production release protections', () => {
  const prod: StageConfig = {
    ...dev,
    stage: 'prod',
    retainData: true,
    deletionProtection: true,
    logRetentionDays: 90,
    monthlyBudgetUsd: 50,
  };
  it('retains and protects production canonical data and identities', () => {
    const app = new cdk.App();
    const data = Template.fromStack(new DataStack(app, 'prod-data', { config: prod }));
    data.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: Match.objectLike({
        DeletionProtectionEnabled: true,
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
          RecoveryPeriodInDays: 35,
        },
      }),
    });
    data.allResources('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    const auth = Template.fromStack(
      new AuthStack(new cdk.App(), 'prod-auth', {
        config: prod,
        frontendDomain: 'frontend.example.test',
      }),
    );
    auth.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        DeletionProtection: 'ACTIVE',
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      }),
    });
  });
  it('honors no-store on runtime configuration and HTML without deleting old assets', () => {
    const app = new cdk.App();
    const edge = Template.fromStack(new EdgeStack(app, 'prod-edge', { config: prod }));
    edge.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({ MinTTL: 0, DefaultTTL: 0, MaxTTL: 31536000 }),
    });
    edge.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
    edge.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
  });
});
