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
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.config.retainData },
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
    const photoProcessor = new lambdaNodejs.NodejsFunction(this, 'PhotoProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/memories/src/handlers/process-photo.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 1024,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        APPLICATION_TABLE_NAME: this.applicationTable.tableName,
        MEDIA_BUCKET_NAME: this.mediaBucket.bucketName,
      },
      bundling: { minify: true, sourceMap: true, nodeModules: ['sharp'] },
    });
    photoProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(this.mediaProcessingQueue, { batchSize: 1 }),
    );
    this.applicationTable.grantReadWriteData(photoProcessor);
    this.mediaBucket.grantReadWrite(photoProcessor);
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
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        responseHeadersPolicy: securityHeaders,
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
  public constructor(scope: Construct, id: string, props: AiStackProps) {
    super(scope, id, props);
    const vectorBucket = new s3vectors.CfnVectorBucket(this, 'VectorBucket', {
      vectorBucketName: `relationship-rag-${props.config.stage}-${cdk.Aws.ACCOUNT_ID}-vectors`,
    });
    const vectorIndex = new s3vectors.CfnIndex(this, 'VectorIndex', {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: `relationship-rag-${props.config.stage}-memories`,
      dataType: 'float32',
      dimension: 1024,
      distanceMetric: 'cosine',
      metadataConfiguration: { nonFilterableMetadataKeys: ['AMAZON_BEDROCK_TEXT'] },
    });
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
    knowledgeBase.addResourceDependency(vectorIndex);
    const dataSource = new bedrock.CfnDataSource(this, 'MemorySource', {
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      name: 'memory-documents',
      dataDeletionPolicy: 'DELETE',
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
      reservedConcurrentExecutions: 1,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        RAG_SOURCE_BUCKET_NAME: props.sourceBucket.bucketName,
        COUPLE_ID: props.config.coupleId,
        KNOWLEDGE_BASE_ID: knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: dataSource.attrDataSourceId,
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
    new cdk.CfnOutput(this, 'FoundationModel', { value: 'amazon.nova-micro-v1:0' });
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
}

export class ApiStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const api = new apigatewayv2.CfnApi(this, 'HttpApi', {
      name: `relationship-rag-${props.config.stage}`,
      protocolType: 'HTTP',
      corsConfiguration: {
        allowHeaders: ['authorization', 'content-type', 'x-correlation-id'],
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
      retention: props.config.retainData
        ? logs.RetentionDays.THREE_MONTHS
        : logs.RetentionDays.ONE_MONTH,
      removalPolicy: removalPolicyFor(props.config),
    });
    const getMeFunction = new lambdaNodejs.NodejsFunction(this, 'GetMeFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/identity/src/handlers/get-me.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        COUPLE_ID: props.config.coupleId,
      },
      logGroup: getMeLogGroup,
      bundling: { minify: true, sourceMap: true },
    });
    props.applicationTable.grantReadData(getMeFunction);
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
      retention: props.config.retainData
        ? logs.RetentionDays.THREE_MONTHS
        : logs.RetentionDays.ONE_MONTH,
      removalPolicy: removalPolicyFor(props.config),
    });
    const memoriesFunction = new lambdaNodejs.NodejsFunction(this, 'MemoriesFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: resolve(process.cwd(), 'services/memories/src/handlers/memories.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(15),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        APPLICATION_TABLE_NAME: props.applicationTable.tableName,
        COUPLE_ID: props.config.coupleId,
        MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
      },
      logGroup: memoriesLogGroup,
      bundling: { minify: true, sourceMap: true },
    });
    props.applicationTable.grantReadWriteData(memoriesFunction);
    props.mediaBucket.grantReadWrite(memoriesFunction);
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
