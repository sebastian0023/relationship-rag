#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { loadStageConfig } from '../lib/config.js';
import {
  AiStack,
  ApiStack,
  AuthStack,
  DataStack,
  EdgeStack,
  MessagingStack,
  ObservabilityStack,
} from '../lib/stacks.js';

const app = new cdk.App();
const requestedStage = String(app.node.tryGetContext('stage') ?? 'dev');
const config = loadStageConfig(requestedStage);
const alertEmailValue = app.node.tryGetContext('alertEmail');
const alertEmail = typeof alertEmailValue === 'string' ? alertEmailValue.trim() : undefined;
if (alertEmail !== undefined && !/^\S+@\S+\.\S+$/.test(alertEmail))
  throw new Error('alertEmail context must be a valid email address.');
const stackProps: cdk.StackProps = {
  description: `Relationship RAG ${config.stage} environment`,
  terminationProtection: config.deletionProtection,
  tags: {
    Application: 'relationship-rag',
    Environment: config.stage,
    CostScope: `relationship-rag-${config.stage}`,
    ManagedBy: 'aws-cdk',
  },
};
const prefix = `relationship-rag-${config.stage}`;

const edge = new EdgeStack(app, `${prefix}-edge`, { ...stackProps, config });
const data = new DataStack(app, `${prefix}-data`, {
  ...stackProps,
  config,
  frontendDomain: edge.distribution.domainName,
});
const auth = new AuthStack(app, `${prefix}-auth`, {
  ...stackProps,
  config,
  frontendDomain: edge.distribution.domainName,
});
const ai = new AiStack(app, `${prefix}-ai`, {
  ...stackProps,
  config,
  sourceBucket: data.ragSourceBucket,
  applicationTable: data.applicationTable,
});
const messaging = new MessagingStack(app, `${prefix}-messaging`, {
  ...stackProps,
  config,
  applicationTable: data.applicationTable,
});
new ApiStack(app, `${prefix}-api`, {
  ...stackProps,
  config,
  applicationTable: data.applicationTable,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  issuer: auth.issuer,
  frontendDomain: edge.distribution.domainName,
  mediaBucket: data.mediaBucket,
  knowledgeBaseId: ai.knowledgeBaseId,
  inferenceProfileArn: ai.inferenceProfileArn,
  deliveryQueue: messaging.deliveryQueue,
  deliveryDlq: messaging.deadLetterQueue,
  schedulerRole: messaging.schedulerRole,
});
const observability = new ObservabilityStack(app, `${prefix}-observability`, {
  ...stackProps,
  config,
  ...(alertEmail === undefined ? {} : { alertEmail }),
});

for (const construct of app.node.findAll()) {
  if (construct instanceof cloudwatch.Alarm)
    construct.addAlarmAction(new cloudwatchActions.SnsAction(observability.alarmTopic));
}
