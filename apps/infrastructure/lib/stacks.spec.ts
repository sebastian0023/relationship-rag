import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import type { StageConfig } from './config.js';
import { AuthStack, DataStack } from './stacks.js';

const dev: StageConfig = {
  stage: 'dev',
  deletionProtection: false,
  retainData: false,
  logRetentionDays: 14,
  monthlyBudgetUsd: 15,
};

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
    const template = Template.fromStack(new AuthStack(app, 'auth-test', { config: dev }));

    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Policies: Match.anyValue(),
    });
  });
});
