#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
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
const stackProps: cdk.StackProps = {
  description: `Relationship RAG ${config.stage} environment`,
  terminationProtection: config.deletionProtection,
  tags: {
    Application: 'relationship-rag',
    Environment: config.stage,
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
});
const messaging = new MessagingStack(app, `${prefix}-messaging`, { ...stackProps, config });
new ObservabilityStack(app, `${prefix}-observability`, {
  ...stackProps,
  config,
  deliveryQueue: messaging.deliveryQueue,
  deadLetterQueue: messaging.deadLetterQueue,
});
