import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

interface RelationshipStackProps extends cdk.StackProps {
  readonly config: StageConfig;
}

const removalPolicyFor = (config: StageConfig): cdk.RemovalPolicy =>
  config.retainData ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

export class DataStack extends cdk.Stack {
  public readonly applicationTable: dynamodb.Table;
  public readonly mediaBucket: s3.Bucket;
  public readonly ragSourceBucket: s3.Bucket;

  public constructor(scope: Construct, id: string, props: RelationshipStackProps) {
    super(scope, id, props);
    const removalPolicy = removalPolicyFor(props.config);

    this.applicationTable = new dynamodb.Table(this, 'ApplicationTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.config.retainData },
      deletionProtection: props.config.deletionProtection,
      removalPolicy,
    });

    this.mediaBucket = this.privateBucket('MediaBucket', props.config, removalPolicy);
    this.ragSourceBucket = this.privateBucket('RagSourceBucket', props.config, removalPolicy);

    new cdk.CfnOutput(this, 'ApplicationTableName', { value: this.applicationTable.tableName });
    new cdk.CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
    new cdk.CfnOutput(this, 'RagSourceBucketName', { value: this.ragSourceBucket.bucketName });
  }

  private privateBucket(
    id: string,
    config: StageConfig,
    removalPolicy: cdk.RemovalPolicy,
  ): s3.Bucket {
    return new s3.Bucket(this, id, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: config.retainData,
      autoDeleteObjects: !config.retainData,
      removalPolicy,
    });
  }
}

export class AuthStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: RelationshipStackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: removalPolicyFor(props.config),
      deletionProtection: props.config.deletionProtection,
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
      },
    });

    const client = userPool.addClient('WebClient', {
      authFlows: { userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    new cognito.CfnUserPoolGroup(this, 'OwnerGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'OWNER',
      precedence: 0,
    });
    new cognito.CfnUserPoolGroup(this, 'PartnerGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'PARTNER',
      precedence: 1,
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
  }
}

export class EdgeStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: RelationshipStackProps) {
    super(scope, id, props);

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: !props.config.retainData,
      removalPolicy: removalPolicyFor(props.config),
    });
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', { value: frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: distribution.domainName });
  }
}

interface AiStackProps extends RelationshipStackProps {
  readonly sourceBucket: s3.IBucket;
}

export class AiStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);

    new cdk.CfnOutput(this, 'SourceBucketArn', { value: props.sourceBucket.bucketArn });
    new cdk.CfnOutput(this, 'FoundationModel', { value: 'amazon.nova-micro-v1:0' });
    new cdk.CfnOutput(this, 'EmbeddingModel', { value: 'amazon.titan-embed-text-v2:0' });
  }
}

export class ApiStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: RelationshipStackProps) {
    super(scope, id, props);

    const api = new apigatewayv2.CfnApi(this, 'HttpApi', {
      name: `relationship-rag-${props.config.stage}`,
      protocolType: 'HTTP',
      corsConfiguration: {
        allowHeaders: ['authorization', 'content-type', 'x-correlation-id'],
        allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
        allowOrigins: props.config.stage === 'prod' ? [] : ['http://localhost:4200'],
      },
    });
    new apigatewayv2.CfnStage(this, 'DefaultStage', {
      apiId: api.ref,
      stageName: '$default',
      autoDeploy: true,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', { value: api.attrApiEndpoint });
  }
}

export class MessagingStack extends cdk.Stack {
  public readonly deliveryQueue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  public constructor(scope: Construct, id: string, props: RelationshipStackProps) {
    super(scope, id, props);

    this.deadLetterQueue = new sqs.Queue(this, 'DeliveryDeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });
    this.deliveryQueue = new sqs.Queue(this, 'DeliveryQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: { maxReceiveCount: 5, queue: this.deadLetterQueue },
    });

    new cdk.CfnOutput(this, 'DeliveryQueueUrl', { value: this.deliveryQueue.queueUrl });
    new cdk.CfnOutput(this, 'DeliveryDeadLetterQueueUrl', {
      value: this.deadLetterQueue.queueUrl,
    });
  }
}

interface ObservabilityStackProps extends RelationshipStackProps {
  readonly deliveryQueue: sqs.IQueue;
  readonly deadLetterQueue: sqs.IQueue;
}

export class ObservabilityStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `relationship-rag-${props.config.stage}`,
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Delivery queues',
        left: [
          props.deliveryQueue.metricApproximateNumberOfMessagesVisible(),
          props.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
        ],
      }),
    );
    new cloudwatch.Alarm(this, 'DeadLetterQueueAlarm', {
      metric: props.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `relationship-rag-${props.config.stage}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.config.monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: [`user:Application$relationship-rag`] },
      },
    });
  }
}
