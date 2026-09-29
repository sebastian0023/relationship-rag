/* global console, process */
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';

const aws = (args) =>
  JSON.parse(
    execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json'], {
      encoding: 'utf8',
    }),
  );
const account = aws(['sts', 'get-caller-identity']).Account;
if (
  !/^\d{12}$/.test(process.env['AWS_ACCOUNT_ID'] ?? '') ||
  account !== process.env['AWS_ACCOUNT_ID']
)
  throw new Error('AWS account does not match the expected test account.');
const stack = (name) => {
  const result = aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    `relationship-rag-test-${name}`,
  ]).Stacks?.[0];
  if (
    !result?.Tags?.some((tag) => tag.Key === 'Environment' && tag.Value === 'test') ||
    !['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(result.StackStatus)
  )
    throw new Error(`Test ${name} stack is not ready.`);
  return Object.fromEntries(
    (result.Outputs ?? []).map((item) => [item.OutputKey, item.OutputValue]),
  );
};
const data = stack('data');
const api = stack('api');
stack('auth');
stack('ai');
stack('messaging');
const apiId = new URL(api.ApiEndpoint).hostname.split('.')[0];
const routes = aws(['apigatewayv2', 'get-routes', '--api-id', apiId]).Items ?? [];
if (
  routes.length !== 25 ||
  routes.some(
    (route) =>
      route.AuthorizationType !== 'JWT' ||
      !route.AuthorizationScopes?.includes('relationship-rag/access'),
  )
)
  throw new Error('A deployed API route is missing JWT authorization or the required scope.');
const table = aws(['dynamodb', 'describe-table', '--table-name', data.ApplicationTableName]).Table;
if (
  table.TableStatus !== 'ACTIVE' ||
  table.BillingModeSummary?.BillingMode !== 'PAY_PER_REQUEST' ||
  table.SSEDescription?.Status !== 'ENABLED'
)
  throw new Error('The test application table is not active, on-demand, and encrypted.');
const backup = aws([
  'dynamodb',
  'describe-continuous-backups',
  '--table-name',
  data.ApplicationTableName,
]);
if (
  backup.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus !==
  'ENABLED'
)
  throw new Error('Test-stage point-in-time recovery is disabled.');
for (const bucket of [data.MediaBucketName, data.RagSourceBucketName]) {
  const block = aws([
    's3api',
    'get-public-access-block',
    '--bucket',
    bucket,
  ]).PublicAccessBlockConfiguration;
  if (!block || Object.values(block).some((value) => value !== true))
    throw new Error('A private test bucket lacks a public access block.');
  const versioning = aws(['s3api', 'get-bucket-versioning', '--bucket', bucket]);
  if (versioning.Status !== 'Enabled') throw new Error('A private test bucket lacks versioning.');
  const encryption = aws(['s3api', 'get-bucket-encryption', '--bucket', bucket]);
  if (!encryption.ServerSideEncryptionConfiguration?.Rules?.length)
    throw new Error('A private test bucket lacks encryption.');
}
console.log(
  'Confirmed test-stage stacks, 25 protected routes, table recovery, and private versioned buckets.',
);
