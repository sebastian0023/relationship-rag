import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3vectors from 'aws-cdk-lib/aws-s3vectors';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { resolve } from 'node:path';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

interface RelationshipStackProps extends cdk.StackProps {
  readonly config: StageConfig;
  readonly frontendDomain?: string;
}

interface AuthStackProps extends RelationshipStackProps {
  readonly frontendDomain: string;
}

const removalPolicyFor = (config: StageConfig): cdk.RemovalPolicy =>
  config.retainData ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

const logRetentionFor = (config: StageConfig): logs.RetentionDays => {
  if (config.logRetentionDays === 14) return logs.RetentionDays.TWO_WEEKS;
  if (config.logRetentionDays === 90) return logs.RetentionDays.THREE_MONTHS;
  throw new Error(`Unsupported log retention: ${config.logRetentionDays} days.`);
};

const functionLogGroup = (scope: Construct, id: string, config: StageConfig): logs.LogGroup =>
  new logs.LogGroup(scope, `${id}LogGroup`, {
    retention: logRetentionFor(config),
    removalPolicy: removalPolicyFor(config),
  });

const addFunctionHealthAlarms = (
  scope: Construct,
  id: string,
  fn: lambda.IFunction,
  latencyThresholdMs: number,
  includeErrorAlarm = true,
): void => {
  const common = {
    evaluationPeriods: 1,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  };
  if (includeErrorAlarm)
    new cloudwatch.Alarm(scope, `${id}ErrorAlarm`, {
      ...common,
      metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
    });
  new cloudwatch.Alarm(scope, `${id}ThrottleAlarm`, {
    ...common,
    metric: fn.metricThrottles({ period: cdk.Duration.minutes(5) }),
    threshold: 1,
  });
  new cloudwatch.Alarm(scope, `${id}LatencyAlarm`, {
    ...common,
    metric: fn.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p95' }),
    threshold: latencyThresholdMs,
  });
};

export class DataStack extends cdk.Stack {
  public readonly applicationTable: dynamodb.Table;
  public readonly mediaBucket: s3.Bucket;
  public readonly ragSourceBucket: s3.Bucket;
  public readonly mediaProcessingQueue: sqs.Queue;
  public readonly mediaProcessingDlq: sqs.Queue;

  public constructor(scope: Construct, id: string, props: RelationshipStackProps) {
    super(scope, id, props);
    const removalPolicy = removalPolicyFor(props.config);

    this.applicationTable = new dynamodb.Table(this, 'ApplicationTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification:
        props.config.stage === 'dev'
          ? { pointInTimeRecoveryEnabled: false }
          : {
              pointInTimeRecoveryEnabled: true,
              recoveryPeriodInDays: props.config.backupRetentionDays,
            },
      deletionProtection: props.config.deletionProtection,
      removalPolicy,
    });

    this.mediaBucket = this.privateBucket('MediaBucket', props.config, removalPolicy);
    this.mediaBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.POST],
      allowedOrigins: [
        ...(props.frontendDomain === undefined ? [] : [`https://${props.frontendDomain}`]),
        ...(props.config.stage === 'dev' ? ['http://localhost:4200'] : []),
      ],
      allowedHeaders: ['content-type'],
      maxAge: 300,
    });
    this.mediaBucket.addLifecycleRule({
      prefix: 'staging/',
      expiration: cdk.Duration.days(1),
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
    });
    this.mediaProcessingDlq = new sqs.Queue(this, 'MediaProcessingDeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy,
    });
    this.mediaProcessingQueue = new sqs.Queue(this, 'MediaProcessingQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(2),
      deadLetterQueue: { queue: this.mediaProcessingDlq, maxReceiveCount: 5 },
      removalPolicy,
    });
    this.mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(this.mediaProcessingQueue),
      { prefix: 'staging/' },
    );
    new cloudwatch.Alarm(this, 'MediaProcessingDeadLetterQueueAlarm', {
      metric: this.mediaProcessingDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const photoProcessor = new lambdaNodejs.NodejsFunction(this, 'PhotoProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/memories/src/handlers/process-photo.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 1024,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: functionLogGroup(this, 'PhotoProcessor', props.config),
      environment: {
        APPLICATION_TABLE_NAME: this.applicationTable.tableName,
        MEDIA_BUCKET_NAME: this.mediaBucket.bucketName,
        STAGE: props.config.stage,
      },
      bundling: { minify: true, sourceMap: true, nodeModules: ['sharp'] },
    });
    photoProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(this.mediaProcessingQueue, { batchSize: 1 }),
    );
    this.applicationTable.grantReadWriteData(photoProcessor);
    this.mediaBucket.grantReadWrite(photoProcessor);
    addFunctionHealthAlarms(this, 'PhotoProcessor', photoProcessor, 110_000);
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
      versioned: config.stage !== 'dev',
      autoDeleteObjects: !config.retainData,
      removalPolicy,
      lifecycleRules:
        config.stage === 'dev'
          ? []
          : [{ noncurrentVersionExpiration: cdk.Duration.days(config.backupRetentionDays) }],
    });
  }
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly issuer: string;

  public constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
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

    const apiAccessScope = new cognito.ResourceServerScope({
      scopeName: 'access',
      scopeDescription: 'Access the Relationship RAG API.',
    });
    const resourceServer = this.userPool.addResourceServer('RelationshipRagApi', {
      identifier: 'relationship-rag',
      scopes: [apiAccessScope],
    });
    this.userPoolClient = this.userPool.addClient('WebClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.resourceServer(resourceServer, apiAccessScope),
        ],
        callbackUrls: [`https://${props.frontendDomain}/auth/callback`],
        logoutUrls: [`https://${props.frontendDomain}/`],
      },
      accessTokenValidity: cdk.Duration.minutes(15),
      idTokenValidity: cdk.Duration.minutes(15),
      refreshTokenValidity: cdk.Duration.days(1),
    });
    this.userPool.addDomain('ManagedLoginDomain', {
      cognitoDomain: {
        domainPrefix: `relationship-rag-${props.config.stage}-${cdk.Aws.ACCOUNT_ID}`,
      },
    });

    new cognito.CfnUserPoolGroup(this, 'OwnerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'OWNER',
      precedence: 0,
    });
    new cognito.CfnUserPoolGroup(this, 'PartnerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'PARTNER',
      precedence: 1,
    });

    this.issuer = this.userPool.userPoolProviderUrl;
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'UserPoolIssuer', { value: this.issuer });
  }
}

export class EdgeStack extends cdk.Stack {
  public readonly frontendBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  public constructor(scope: Construct, id: string, props: RelationshipStackProps) {
    super(scope, id, props);

    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: !props.config.retainData,
      removalPolicy: removalPolicyFor(props.config),
    });
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
      },
    });
    const frontendOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket);
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: frontendOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        responseHeadersPolicy: securityHeaders,
      },
      additionalBehaviors: {
        'assets/runtime-config.json': {
          origin: frontendOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          responseHeadersPolicy: securityHeaders,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', { value: this.frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distribution.domainName });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }
}

interface AiStackProps extends RelationshipStackProps {
  readonly sourceBucket: s3.IBucket;
  readonly applicationTable: dynamodb.ITable;
}

export class AiStack extends cdk.Stack {
  public readonly knowledgeBaseId: string;
  public readonly dataSourceId: string;
  public readonly inferenceProfileArn: string;
  public constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);
    const foundationModelArn = `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.nova-micro-v1:0`;
    const inferenceProfile = new bedrock.CfnApplicationInferenceProfile(
      this,
      'GenerationInferenceProfile',
      {
        inferenceProfileName: `relationship-rag-${props.config.stage}-generation`,
        description: 'Attributed chat and card generation for Relationship RAG',
        modelSource: { copyFrom: foundationModelArn },
        tags: [
          { key: 'Application', value: 'relationship-rag' },
          { key: 'Environment', value: props.config.stage },
        ],
      },
    );
    this.inferenceProfileArn = inferenceProfile.attrInferenceProfileArn;
    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
      vectorBucketName: `relationship-rag-${props.config.stage}-${cdk.Aws.ACCOUNT_ID}-vectors`,
    });
    vectorBucket.applyRemovalPolicy(removalPolicyFor(props.config));
    const vectorIndex = new s3vectors.CfnIndex(this, 'VectorIndex', {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: `relationship-rag-${props.config.stage}-memories`,
      dataType: 'float32',
      dimension: 1024,
      distanceMetric: 'cosine',
      metadataConfiguration: { nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT'] },
    });
    vectorIndex.applyRemovalPolicy(removalPolicyFor(props.config));
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    });
    props.sourceBucket.grantRead(knowledgeBaseRole);
    knowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );
    knowledgeBaseRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          's3vectors:PutVectors',
          's3vectors:GetVectors',
          's3vectors:GetIndex',
          's3vectors:QueryVectors',
          's3vectors:DeleteVectors',
        ],
        resources: [vectorIndex.attrIndexArn],
      }),
    );
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'KnowledgeBase', {
      name: `relationship-rag-${props.config.stage}-memories`,
      roleArn: knowledgeBaseRole.roleArn,
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.titan-embed-text-v2:0`,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: { dimensions: 1024, embeddingDataType: 'FLOAT32' },
          },
        },
      },
      storageConfiguration: {
        type: 'S3_VECTORS',
        s3VectorsConfiguration: {
          vectorBucketArn: vectorBucket.attrVectorBucketArn,
          indexArn: vectorIndex.attrIndexArn,
        },
      },
    });
    knowledgeBase.applyRemovalPolicy(removalPolicyFor(props.config));
    knowledgeBase.addResourceDependency(vectorIndex);
    knowledgeBase.addDependency(
      (knowledgeBaseRole.node.findChild('DefaultPolicy') as iam.Policy).node
        .defaultChild as iam.CfnPolicy,
    );
    const dataSource = new bedrock.CfnDataSource(this, 'MemorySource', {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: 'memory-documents',
      dataDeletionPolicy: props.config.retainData ? 'RETAIN' : 'DELETE',
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: { bucketArn: props.sourceBucket.bucketArn },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'FIXED_SIZE',
          fixedSizeChunkingConfiguration: { maxTokens: 300, overlapPercentage: 20 },
        },
      },
    });
    dataSource.applyRemovalPolicy(removalPolicyFor(props.config));
    const ingestionDlq = new sqs.Queue(this, 'IngestionDeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: removalPolicyFor(props.config),
    });
    const ingestionQueue = new sqs.Queue(this, 'IngestionQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(2),
      deadLetterQueue: { queue: ingestionDlq, maxReceiveCount: 5 },
      removalPolicy: removalPolicyFor(props.config),
    });
    new events.Rule(this, 'IngestionSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new eventTargets.SqsQueue(ingestionQueue)],
    });
    const coordinator = new lambdaNodejs.NodejsFunction(this, 'IngestionCoordinatorFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/memories/src/handlers/process-ingestion.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
      ...(props.config.reserveLambdaConcurrency ? { reservedConcurrentExecutions: 1 } : {}),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: functionLogGroup(this, 'IngestionCoordinator', props.config),
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        RAG_SOURCE_BUCKET_NAME: props.sourceBucket.bucketName,
        COUPLE_ID: props.config.coupleId,
        KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: dataSource.attrDataSourceId,
        STAGE: props.config.stage,
      },
      bundling: { minify: true, sourceMap: true },
    });
    coordinator.addEventSource(
      new lambdaEventSources.SqsEventSource(ingestionQueue, { batchSize: 1 }),
    );
    props.applicationTable.grantReadWriteData(coordinator);
    props.sourceBucket.grantReadWrite(coordinator);
    coordinator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:StartIngestionJob',
          'bedrock:GetIngestionJob',
          'bedrock:StopIngestionJob',
        ],
        resources: [knowledgeBase.attrKnowledgeBaseArn],
      }),
    );
    addFunctionHealthAlarms(this, 'IngestionCoordinator', coordinator, 55_000, false);
    new cloudwatch.Alarm(this, 'IngestionDeadLetterQueueAlarm', {
      metric: ingestionDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'IngestionCoordinatorErrorAlarm', {
      metric: coordinator.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'IngestionPendingAgeAlarm', {
      metric: ingestionQueue.metricApproximateAgeOfOldestMessage(),
      threshold: 30 * 60,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    this.knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    this.dataSourceId = dataSource.attrDataSourceId;
    new cdk.CfnOutput(this, 'SourceBucketArn', { value: props.sourceBucket.bucketArn });
    new cdk.CfnOutput(this, 'KnowledgeBaseId', { value: this.knowledgeBaseId });
    new cdk.CfnOutput(this, 'DataSourceId', { value: this.dataSourceId });
    new cdk.CfnOutput(this, 'FoundationModel', { value: foundationModelArn });
    new cdk.CfnOutput(this, 'GenerationInferenceProfileArn', {
      value: this.inferenceProfileArn,
    });
    new cdk.CfnOutput(this, 'EmbeddingModel', { value: 'amazon.titan-embed-text-v2:0' });
  }
}

interface ApiStackProps extends RelationshipStackProps {
  readonly applicationTable: dynamodb.ITable;
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
  readonly issuer: string;
  readonly frontendDomain: string;
  readonly mediaBucket: s3.IBucket;
  readonly knowledgeBaseId: string;
  readonly inferenceProfileArn: string;
  readonly deliveryQueue: sqs.IQueue;
  readonly deliveryDlq: sqs.IQueue;
  readonly schedulerRole: iam.IRole;
}

export class ApiStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const adotInstrumentation: lambda.AdotInstrumentationConfig = {
      layerVersion: lambda.AdotLayerVersion.fromJavaScriptSdkLayerVersion(
        lambda.AdotLambdaLayerJavaScriptSdkVersion.V1_30_0,
      ),
      execWrapper: lambda.AdotLambdaExecWrapper.REGULAR_HANDLER,
    };
    // ADOT replaces the handler export at runtime; cloning esbuild's getters makes it writable.
    const adotBundling: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      footer: 'module.exports = { ...module.exports };',
    };

    const api = new apigatewayv2.CfnApi(this, 'HttpApi', {
      name: `relationship-rag-${props.config.stage}`,
      protocolType: 'HTTP',
      corsConfiguration: {
        allowHeaders: ['authorization', 'content-type', 'x-correlation-id'],
        exposeHeaders: ['x-correlation-id'],
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowOrigins:
          props.config.stage === 'dev'
            ? [`https://${props.frontendDomain}`, 'http://localhost:4200']
            : [`https://${props.frontendDomain}`],
      },
    });
    const authorizer = new apigatewayv2.CfnAuthorizer(this, 'JwtAuthorizer', {
      apiId: api.ref,
      authorizerType: 'JWT',
      identitySource: ['$request.header.Authorization'],
      jwtConfiguration: {
        audience: [props.userPoolClient.userPoolClientId],
        issuer: props.issuer,
      },
      name: 'cognito-jwt',
    });
    const getMeLogGroup = new logs.LogGroup(this, 'GetMeLogGroup', {
      retention: logRetentionFor(props.config),
      removalPolicy: removalPolicyFor(props.config),
    });
    const getMeFunction = new lambdaNodejs.NodejsFunction(this, 'GetMeFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/identity/src/handlers/get-me.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      adotInstrumentation,
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        COUPLE_ID: props.config.coupleId,
        STAGE: props.config.stage,
      },
      logGroup: getMeLogGroup,
      bundling: adotBundling,
    });
    props.applicationTable.grantReadData(getMeFunction);
    addFunctionHealthAlarms(this, 'GetMe', getMeFunction, 2_000);
    const getMeIntegration = new apigatewayv2.CfnIntegration(this, 'GetMeIntegration', {
      apiId: api.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: getMeFunction.functionArn,
      payloadFormatVersion: '2.0',
    });
    getMeFunction.addPermission('ApiGatewayGetMeInvocation', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: cdk.Stack.of(this).formatArn({
        service: 'execute-api',
        resource: `${api.ref}/*/GET/me`,
      }),
    });
    new apigatewayv2.CfnRoute(this, 'GetMeRoute', {
      apiId: api.ref,
      routeKey: 'GET /me',
      authorizationType: 'JWT',
      authorizerId: authorizer.ref,
      authorizationScopes: ['relationship-rag/access'],
      target: `integrations/${getMeIntegration.ref}`,
    });
    const memoriesLogGroup = new logs.LogGroup(this, 'MemoriesLogGroup', {
      retention: logRetentionFor(props.config),
      removalPolicy: removalPolicyFor(props.config),
    });
    const memoriesFunction = new lambdaNodejs.NodejsFunction(this, 'MemoriesFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/memories/src/handlers/memories.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      adotInstrumentation,
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        COUPLE_ID: props.config.coupleId,
        MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
        STAGE: props.config.stage,
      },
      logGroup: memoriesLogGroup,
      bundling: adotBundling,
    });
    props.applicationTable.grantReadWriteData(memoriesFunction);
    props.mediaBucket.grantReadWrite(memoriesFunction);
    addFunctionHealthAlarms(this, 'Memories', memoriesFunction, 2_000);
    const memoriesIntegration = new apigatewayv2.CfnIntegration(this, 'MemoriesIntegration', {
      apiId: api.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: memoriesFunction.functionArn,
      payloadFormatVersion: '2.0',
    });
    for (const [id, routeKey] of [
      ['TimelineRoute', 'GET /timeline'],
      ['CreateMemoryRoute', 'POST /memories'],
      ['GetMemoryRoute', 'GET /memories/{memoryId}'],
      ['UpdateMemoryRoute', 'PATCH /memories/{memoryId}'],
      ['DeleteMemoryRoute', 'DELETE /memories/{memoryId}'],
      ['CreateUploadRoute', 'POST /memories/{memoryId}/uploads'],
      ['DeletePhotoRoute', 'DELETE /memories/{memoryId}/photos/{photoId}'],
      ['GetIngestionRoute', 'GET /memories/{memoryId}/ingestion'],
      ['ReindexMemoryRoute', 'POST /memories/{memoryId}/reindex'],
    ] as const) {
      new apigatewayv2.CfnRoute(this, id, {
        apiId: api.ref,
        routeKey,
        authorizationType: 'JWT',
        authorizerId: authorizer.ref,
        authorizationScopes: ['relationship-rag/access'],
        target: `integrations/${memoriesIntegration.ref}`,
      });
    }
    memoriesFunction.addPermission('ApiGatewayMemoriesInvocation', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: cdk.Stack.of(this).formatArn({
        service: 'execute-api',
        resource: `${api.ref}/*/*/*`,
      }),
    });
    const chatLogGroup = new logs.LogGroup(this, 'ChatLogGroup', {
      retention: logRetentionFor(props.config),
      removalPolicy: removalPolicyFor(props.config),
    });
    const chatFunction = new lambdaNodejs.NodejsFunction(this, 'ChatFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/chat/src/handlers/chat.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(28),
      memorySize: 1024,
      ...(props.config.reserveLambdaConcurrency
        ? { reservedConcurrentExecutions: props.config.aiReservedConcurrency }
        : {}),
      tracing: lambda.Tracing.ACTIVE,
      adotInstrumentation,
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        COUPLE_ID: props.config.coupleId,
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
        AI_DEADLINE_MS: String(props.config.aiDeadlineMs),
        MODEL_ID: props.inferenceProfileArn,
        STAGE: props.config.stage,
      },
      logGroup: chatLogGroup,
      bundling: adotBundling,
    });
    props.applicationTable.grantReadWriteData(chatFunction);
    chatFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:Retrieve'],
        resources: [
          `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:knowledge-base/${props.knowledgeBaseId}`,
        ],
      }),
    );
    addFunctionHealthAlarms(this, 'Chat', chatFunction, 20_000, false);
    chatFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          props.inferenceProfileArn,
          `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.nova-micro-v1:0`,
        ],
      }),
    );
    const chatIntegration = new apigatewayv2.CfnIntegration(this, 'ChatIntegration', {
      apiId: api.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: chatFunction.functionArn,
      payloadFormatVersion: '2.0',
      timeoutInMillis: 30_000,
    });
    for (const [id, routeKey] of [
      ['CreateConversationRoute', 'POST /conversations'],
      ['ListConversationsRoute', 'GET /conversations'],
      ['GetConversationRoute', 'GET /conversations/{conversationId}'],
      ['CreateChatMessageRoute', 'POST /conversations/{conversationId}/messages'],
    ] as const) {
      new apigatewayv2.CfnRoute(this, id, {
        apiId: api.ref,
        routeKey,
        authorizationType: 'JWT',
        authorizerId: authorizer.ref,
        authorizationScopes: ['relationship-rag/access'],
        target: `integrations/${chatIntegration.ref}`,
      });
    }
    chatFunction.addPermission('ApiGatewayChatInvocation', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: cdk.Stack.of(this).formatArn({
        service: 'execute-api',
        resource: `${api.ref}/*/*/*`,
      }),
    });
    new cloudwatch.Alarm(this, 'ChatDependencyFailureAlarm', {
      metric: chatFunction.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const cardsLogGroup = new logs.LogGroup(this, 'CardsLogGroup', {
      retention: logRetentionFor(props.config),
      removalPolicy: removalPolicyFor(props.config),
    });
    const cardsFunction = new lambdaNodejs.NodejsFunction(this, 'CardsFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/cards/src/handlers/cards.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(28),
      memorySize: 1024,
      ...(props.config.reserveLambdaConcurrency
        ? { reservedConcurrentExecutions: props.config.aiReservedConcurrency }
        : {}),
      tracing: lambda.Tracing.ACTIVE,
      adotInstrumentation,
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        COUPLE_ID: props.config.coupleId,
        DELIVERY_QUEUE_URL: props.deliveryQueue.queueUrl,
        DELIVERY_QUEUE_ARN: props.deliveryQueue.queueArn,
        SCHEDULER_ROLE_ARN: props.schedulerRole.roleArn,
        SCHEDULER_DLQ_ARN: props.deliveryDlq.queueArn,
        AI_DEADLINE_MS: String(props.config.aiDeadlineMs),
        MODEL_ID: props.inferenceProfileArn,
        STAGE: props.config.stage,
      },
      logGroup: cardsLogGroup,
      bundling: adotBundling,
    });
    props.applicationTable.grantReadWriteData(cardsFunction);
    props.deliveryQueue.grantSendMessages(cardsFunction);
    cardsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          props.inferenceProfileArn,
          `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.nova-micro-v1:0`,
        ],
      }),
    );
    addFunctionHealthAlarms(this, 'Cards', cardsFunction, 20_000, false);
    cardsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule'],
        resources: [
          `arn:${cdk.Aws.PARTITION}:scheduler:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:schedule/default/delivery-*`,
        ],
      }),
    );
    cardsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [props.schedulerRole.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
      }),
    );
    const cardsIntegration = new apigatewayv2.CfnIntegration(this, 'CardsIntegration', {
      apiId: api.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: cardsFunction.functionArn,
      payloadFormatVersion: '2.0',
      timeoutInMillis: 30_000,
    });
    for (const [id, routeKey] of [
      ['CardRecipientsRoute', 'GET /cards/recipients'],
      ['GenerateCardRoute', 'POST /cards/generate'],
      ['CreateCardRoute', 'POST /cards'],
      ['ListCardsRoute', 'GET /cards'],
      ['GetCardRoute', 'GET /cards/{cardId}'],
      ['UpdateCardRoute', 'PATCH /cards/{cardId}'],
      ['DeleteCardRoute', 'DELETE /cards/{cardId}'],
      ['SendCardRoute', 'POST /cards/{cardId}/send'],
    ] as const)
      new apigatewayv2.CfnRoute(this, id, {
        apiId: api.ref,
        routeKey,
        authorizationType: 'JWT',
        authorizerId: authorizer.ref,
        authorizationScopes: ['relationship-rag/access'],
        target: `integrations/${cardsIntegration.ref}`,
      });
    cardsFunction.addPermission('ApiGatewayCardsInvocation', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: cdk.Stack.of(this).formatArn({
        service: 'execute-api',
        resource: `${api.ref}/*/*/*`,
      }),
    });
    new cloudwatch.Alarm(this, 'CardGenerationFailureAlarm', {
      metric: cardsFunction.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const inboxFunction = new lambdaNodejs.NodejsFunction(this, 'InboxFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/notifications/src/handlers/inbox.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      adotInstrumentation,
      logGroup: functionLogGroup(this, 'Inbox', props.config),
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        COUPLE_ID: props.config.coupleId,
        STAGE: props.config.stage,
      },
      bundling: adotBundling,
    });
    props.applicationTable.grantReadWriteData(inboxFunction);
    addFunctionHealthAlarms(this, 'Inbox', inboxFunction, 2_000);
    const inboxIntegration = new apigatewayv2.CfnIntegration(this, 'InboxIntegration', {
      apiId: api.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: inboxFunction.functionArn,
      payloadFormatVersion: '2.0',
    });
    for (const [id, routeKey] of [
      ['ListInboxRoute', 'GET /inbox'],
      ['GetInboxRoute', 'GET /inbox/{cardId}'],
      ['ReadInboxRoute', 'PATCH /inbox/{cardId}/read'],
    ] as const)
      new apigatewayv2.CfnRoute(this, id, {
        apiId: api.ref,
        routeKey,
        authorizationType: 'JWT',
        authorizerId: authorizer.ref,
        authorizationScopes: ['relationship-rag/access'],
        target: `integrations/${inboxIntegration.ref}`,
      });
    inboxFunction.addPermission('ApiGatewayInboxInvocation', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: cdk.Stack.of(this).formatArn({
        service: 'execute-api',
        resource: `${api.ref}/*/*/*`,
      }),
    });
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogGroup', {
      retention: logRetentionFor(props.config),
      removalPolicy: removalPolicyFor(props.config),
    });
    accessLogGroup.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('apigateway.amazonaws.com')],
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`${accessLogGroup.logGroupArn}:*`],
      }),
    );
    const stage = new apigatewayv2.CfnStage(this, 'DefaultStage', {
      apiId: api.ref,
      stageName: '$default',
      autoDeploy: true,
      defaultRouteSettings: {
        throttlingRateLimit: props.config.apiRateLimit,
        throttlingBurstLimit: props.config.apiBurstLimit,
        detailedMetricsEnabled: true,
      },
      routeSettings: {
        'POST /cards/generate': {
          ThrottlingRateLimit: 0.2,
          ThrottlingBurstLimit: 2,
          DetailedMetricsEnabled: true,
        },
        'POST /conversations/{conversationId}/messages': {
          ThrottlingRateLimit: 0.2,
          ThrottlingBurstLimit: 2,
          DetailedMetricsEnabled: true,
        },
      },
      accessLogSettings: {
        destinationArn: accessLogGroup.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          routeKey: '$context.routeKey',
          status: '$context.status',
          integrationStatus: '$context.integration.status',
          responseLatency: '$context.responseLatency',
          stage: props.config.stage,
          service: 'api',
        }),
      },
    });
    stage.addDependency(this.node.findChild('GenerateCardRoute') as apigatewayv2.CfnRoute);
    stage.addDependency(this.node.findChild('CreateChatMessageRoute') as apigatewayv2.CfnRoute);

    const apiDimensions = { ApiId: api.ref, Stage: '$default' };
    new cloudwatch.Alarm(this, 'ApiServerErrorAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5xx',
        dimensionsMap: apiDimensions,
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const throttleMetric = new logs.MetricFilter(this, 'ApiThrottleMetric', {
      logGroup: accessLogGroup,
      filterPattern: logs.FilterPattern.stringValue('$.status', '=', '429'),
      metricNamespace: 'RelationshipRag',
      metricName: 'ApiThrottle',
      metricValue: '1',
      defaultValue: 0,
    });
    new cloudwatch.Alarm(this, 'ApiThrottleAlarm', {
      metric: throttleMetric.metric({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', { value: api.attrApiEndpoint });
  }
}

export class MessagingStack extends cdk.Stack {
  public readonly deliveryQueue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly schedulerRole: iam.Role;

  public constructor(
    scope: Construct,
    id: string,
    props: RelationshipStackProps & { readonly applicationTable: dynamodb.ITable },
  ) {
    super(scope, id, props);

    this.deadLetterQueue = new sqs.Queue(this, 'DeliveryDeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: removalPolicyFor(props.config),
    });
    this.deliveryQueue = new sqs.Queue(this, 'DeliveryQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: { maxReceiveCount: 5, queue: this.deadLetterQueue },
      removalPolicy: removalPolicyFor(props.config),
    });

    this.schedulerRole = new iam.Role(this, 'SchedulerDeliveryRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    this.deliveryQueue.grantSendMessages(this.schedulerRole);
    this.deadLetterQueue.grantSendMessages(this.schedulerRole);

    const worker = new lambdaNodejs.NodejsFunction(this, 'DeliveryWorkerFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/notifications/src/handlers/process-delivery.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: functionLogGroup(this, 'DeliveryWorker', props.config),
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        STAGE: props.config.stage,
      },
      bundling: { minify: true, sourceMap: true },
    });
    worker.addEventSource(
      new lambdaEventSources.SqsEventSource(this.deliveryQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
    props.applicationTable.grantReadWriteData(worker);
    addFunctionHealthAlarms(this, 'DeliveryWorker', worker, 8_000, false);

    const failureArchiver = new lambdaNodejs.NodejsFunction(
      this,
      'DeliveryFailureArchiverFunction',
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: resolve(
          process.cwd(),
          'services/notifications/src/handlers/archive-delivery-failure.ts',
        ),
        handler: 'handler',
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        tracing: lambda.Tracing.ACTIVE,
        logGroup: functionLogGroup(this, 'DeliveryFailureArchiver', props.config),
        environment: {
          APPLICATION_TABLE_NAME: props.applicationTable.tableName,
          STAGE: props.config.stage,
        },
        bundling: { minify: true, sourceMap: true },
      },
    );
    failureArchiver.addEventSource(
      new lambdaEventSources.SqsEventSource(this.deadLetterQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
    props.applicationTable.grantReadWriteData(failureArchiver);
    addFunctionHealthAlarms(this, 'DeliveryFailureArchiver', failureArchiver, 8_000);

    const coordinator = new lambdaNodejs.NodejsFunction(
      this,
      'DeliveryDispatchCoordinatorFunction',
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: resolve(process.cwd(), 'services/notifications/src/handlers/dispatch-deliveries.ts'),
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        ...(props.config.reserveLambdaConcurrency ? { reservedConcurrentExecutions: 1 } : {}),
        tracing: lambda.Tracing.ACTIVE,
        logGroup: functionLogGroup(this, 'DeliveryDispatchCoordinator', props.config),
        environment: {
          APPLICATION_TABLE_NAME: props.applicationTable.tableName,
          COUPLE_ID: props.config.coupleId,
          DELIVERY_QUEUE_URL: this.deliveryQueue.queueUrl,
          DELIVERY_QUEUE_ARN: this.deliveryQueue.queueArn,
          SCHEDULER_ROLE_ARN: this.schedulerRole.roleArn,
          SCHEDULER_DLQ_ARN: this.deadLetterQueue.queueArn,
          STAGE: props.config.stage,
        },
        bundling: { minify: true, sourceMap: true },
      },
    );
    props.applicationTable.grantReadWriteData(coordinator);
    addFunctionHealthAlarms(this, 'DeliveryDispatchCoordinator', coordinator, 25_000, false);
    this.deliveryQueue.grantSendMessages(coordinator);
    coordinator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule'],
        resources: [
          `arn:${cdk.Aws.PARTITION}:scheduler:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:schedule/default/delivery-*`,
        ],
      }),
    );
    coordinator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [this.schedulerRole.roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } },
      }),
    );
    new events.Rule(this, 'DeliveryDispatchSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new eventTargets.LambdaFunction(coordinator)],
    });
    new cloudwatch.Alarm(this, 'DeliveryWorkerErrorAlarm', {
      metric: worker.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'DeliveryDispatchErrorAlarm', {
      metric: coordinator.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, 'DeliveryBacklogAgeAlarm', {
      metric: this.deliveryQueue.metricApproximateAgeOfOldestMessage(),
      threshold: 300,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cdk.CfnOutput(this, 'DeliveryQueueUrl', { value: this.deliveryQueue.queueUrl });
    new cdk.CfnOutput(this, 'DeliveryDeadLetterQueueUrl', {
      value: this.deadLetterQueue.queueUrl,
    });
  }
}

interface ObservabilityStackProps extends RelationshipStackProps {
  readonly alertEmail?: string;
}

export class ObservabilityStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  public constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: `Relationship RAG ${props.config.stage} alerts`,
      masterKey: kms.Alias.fromAliasName(this, 'SnsKey', 'alias/aws/sns'),
    });
    this.alarmTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.alarmTopic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': cdk.Aws.ACCOUNT_ID } },
      }),
    );
    if (props.alertEmail !== undefined)
      this.alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(props.alertEmail));

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: `relationship-rag-${props.config.stage}`,
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Handled failures',
        left: [
          new cloudwatch.Metric({
            namespace: 'RelationshipRag',
            metricName: 'DependencyFailure',
            dimensionsMap: { Stage: props.config.stage, Service: 'chat' },
            statistic: 'Sum',
          }),
          new cloudwatch.Metric({
            namespace: 'RelationshipRag',
            metricName: 'RecordFailure',
            dimensionsMap: { Stage: props.config.stage, Service: 'delivery' },
            statistic: 'Sum',
          }),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: 'AI usage',
        left: ['chat', 'cards'].flatMap((service) => [
          new cloudwatch.Metric({
            namespace: 'RelationshipRag',
            metricName: 'ModelInputTokens',
            dimensionsMap: { Stage: props.config.stage, Service: service },
            statistic: 'Sum',
          }),
          new cloudwatch.Metric({
            namespace: 'RelationshipRag',
            metricName: 'ModelOutputTokens',
            dimensionsMap: { Stage: props.config.stage, Service: service },
            statistic: 'Sum',
          }),
        ]),
      }),
    );
    for (const [id, service, metricName, threshold] of [
      ['ChatHandledDependencyFailureAlarm', 'chat', 'DependencyFailure', 1],
      ['CardHandledDependencyFailureAlarm', 'cards', 'DependencyFailure', 1],
      ['DeliveryRecordFailureAlarm', 'delivery', 'RecordFailure', 1],
      ['DeliveryTerminalFailureAlarm', 'delivery', 'TerminalFailure', 1],
      ['IngestionRecordFailureAlarm', 'ingestion', 'RecordFailure', 1],
      ['MediaRecordFailureAlarm', 'media', 'RecordFailure', 1],
      ['IdentityDependencyFailureAlarm', 'identity', 'DependencyFailure', 1],
      ['MemoriesDependencyFailureAlarm', 'memories', 'DependencyFailure', 1],
      ['InboxDependencyFailureAlarm', 'inbox', 'DependencyFailure', 1],
    ] as const) {
      new cloudwatch.Alarm(this, id, {
        metric: new cloudwatch.Metric({
          namespace: 'RelationshipRag',
          metricName,
          dimensionsMap: { Stage: props.config.stage, Service: service },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        threshold,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }
    new cloudwatch.Alarm(this, 'IngestionHeartbeatAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'RelationshipRag',
        metricName: 'CoordinatorHeartbeat',
        dimensionsMap: { Stage: props.config.stage, Service: 'ingestion' },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    const subscriber = { address: this.alarmTopic.topicArn, subscriptionType: 'SNS' };
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `relationship-rag-${props.config.stage}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.config.monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: [`user:CostScope$relationship-rag-${props.config.stage}`] },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [subscriber],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [subscriber],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'FORECASTED',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [subscriber],
        },
      ],
    });
    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
  }
}
