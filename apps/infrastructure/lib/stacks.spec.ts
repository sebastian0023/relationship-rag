import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
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
  reserveLambdaConcurrency: true,
  aiDeadlineMs: 24_000,
  backupRetentionDays: 35,
};
const testStage: StageConfig = {
  ...dev,
  stage: 'test',
  coupleId: 'couple-test',
  reserveLambdaConcurrency: false,
};
const prodStage: StageConfig = {
  ...testStage,
  stage: 'prod',
  coupleId: 'couple-prod',
  deletionProtection: true,
  retainData: true,
};

describe('privacy infrastructure', () => {
  it('disables CloudFront caching for runtime configuration', () => {
    const app = new cdk.App();
    const template = Template.fromStack(new EdgeStack(app, 'edge-test', { config: dev }));

    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({
            PathPattern: 'assets/runtime-config.json',
            CachePolicyId: cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId,
          }),
        ]),
      },
    });
  });

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
    expect(template.toJSON().Resources['KnowledgeBase'].DependsOn).toContain(
      Object.keys(template.findResources('AWS::IAM::Policy')).find((id) =>
        id.startsWith('KnowledgeBaseRoleDefaultPolicy'),
      ),
    );
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(['s3vectors:GetIndex']) }),
        ]),
      },
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

  it('retains production vector data and knowledge base resources', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'data-prod', { config: prodStage });
    const template = Template.fromStack(
      new AiStack(app, 'ai-prod', {
        config: prodStage,
        sourceBucket: data.ragSourceBucket,
        applicationTable: data.applicationTable,
      }),
    );

    template.hasResourceProperties('AWS::Bedrock::DataSource', { DataDeletionPolicy: 'RETAIN' });
    for (const type of [
      'AWS::S3Vectors::VectorBucket',
      'AWS::S3Vectors::Index',
      'AWS::Bedrock::KnowledgeBase',
      'AWS::Bedrock::DataSource',
    ]) {
      const resources = Object.values(template.findResources(type));
      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      });
    }
  });

  it('uses the account concurrency limit when reservations are disabled', () => {
    const app = new cdk.App();
    const data = new DataStack(app, 'data-test', { config: testStage });
    const auth = new AuthStack(app, 'auth-test', {
      config: testStage,
      frontendDomain: 'frontend.example.test',
    });
    const ai = new AiStack(app, 'ai-test', {
      config: testStage,
      sourceBucket: data.ragSourceBucket,
      applicationTable: data.applicationTable,
    });
    const messaging = new MessagingStack(app, 'messaging-test', {
      config: testStage,
      applicationTable: data.applicationTable,
    });
    const api = new ApiStack(app, 'api-test', {
      config: testStage,
      applicationTable: data.applicationTable,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      issuer: auth.issuer,
      frontendDomain: 'frontend.example.test',
      mediaBucket: data.mediaBucket,
      knowledgeBaseId: ai.knowledgeBaseId,
      inferenceProfileArn: ai.inferenceProfileArn,
      deliveryQueue: messaging.deliveryQueue,
      deliveryDlq: messaging.deadLetterQueue,
      schedulerRole: messaging.schedulerRole,
    });

    for (const stack of [data, ai, messaging, api]) {
      const functions = Object.values(
        Template.fromStack(stack).findResources('AWS::Lambda::Function'),
      );
      expect(functions.length).toBeGreaterThan(0);
      for (const fn of functions)
        expect(fn.Properties?.ReservedConcurrentExecutions).toBeUndefined();
    }
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
      RouteSettings: {
        'POST /cards/generate': {
          ThrottlingBurstLimit: 2,
          ThrottlingRateLimit: 0.2,
          DetailedMetricsEnabled: true,
        },
        'POST /conversations/{conversationId}/messages': {
          ThrottlingBurstLimit: 2,
          ThrottlingRateLimit: 0.2,
          DetailedMetricsEnabled: true,
        },
      },
    });
    expect(template.toJSON().Resources['DefaultStage'].DependsOn).toEqual(
      expect.arrayContaining(['GenerateCardRoute', 'CreateChatMessageRoute']),
    );
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
