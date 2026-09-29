/* global console, process */
import { execFileSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  DeleteScheduleCommand,
  GetScheduleCommand,
  SchedulerClient,
} from '@aws-sdk/client-scheduler';
import { cleanupFixtures, loadManifest } from './live-fixtures.mjs';

const [manifestPath, flag] = process.argv.slice(2);
if (!manifestPath || (flag !== undefined && flag !== '--confirm'))
  throw new Error('Usage: npm run test:fixtures:cleanup -- <manifest-path> [--confirm]');
const manifest = await loadManifest(manifestPath);
const region = manifest.region;
const table = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });
const scheduler = new SchedulerClient({ region });
const store = {
  accountId: async () =>
    execFileSync(
      'aws',
      ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', '--region', region],
      { encoding: 'utf8' },
    ).trim(),
  stageResources: async () => {
    const stack = JSON.parse(
      execFileSync(
        'aws',
        [
          'cloudformation',
          'describe-stacks',
          '--stack-name',
          'relationship-rag-test-data',
          '--region',
          region,
          '--output',
          'json',
        ],
        { encoding: 'utf8' },
      ),
    ).Stacks?.[0];
    if (
      !stack?.Tags?.some((tag) => tag.Key === 'Environment' && tag.Value === 'test') ||
      !['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus)
    )
      throw new Error('Existing test-stage data stack is not ready.');
    const outputs = Object.fromEntries(
      (stack.Outputs ?? []).map((item) => [item.OutputKey, item.OutputValue]),
    );
    return {
      tableName: outputs.ApplicationTableName,
      mediaBucket: outputs.MediaBucketName,
      sourceBucket: outputs.RagSourceBucketName,
    };
  },
  get: async (Key) =>
    (await table.send(new GetCommand({ TableName: manifest.tableName, Key, ConsistentRead: true })))
      .Item,
  query: async (PK, prefix) => {
    const rows = [];
    let cursor;
    do {
      const page = await table.send(
        new QueryCommand({
          TableName: manifest.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': PK, ':prefix': prefix },
          ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }),
      );
      rows.push(...(page.Items ?? []));
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return rows;
  },
  remove: async (Key) => {
    await table.send(new DeleteCommand({ TableName: manifest.tableName, Key }));
  },
  removeSchedule: async (Name) => {
    try {
      await scheduler.send(new GetScheduleCommand({ Name }));
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') return;
      throw error;
    }
    await scheduler.send(new DeleteScheduleCommand({ Name }));
  },
  hasSchedule: async (Name) => {
    try {
      await scheduler.send(new GetScheduleCommand({ Name }));
      return true;
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') return false;
      throw error;
    }
  },
  hasCurrentObject: async (Bucket, Key) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket, Key }));
      return true;
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  },
  currentObjects: async (Bucket, key, exact) => {
    const matches = [];
    let ContinuationToken;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: key,
          ...(ContinuationToken ? { ContinuationToken } : {}),
        }),
      );
      for (const object of page.Contents ?? [])
        if (object.Key && (!exact || object.Key === key)) matches.push({ Key: object.Key });
      ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
    return matches;
  },
};
store.removeCurrentObjects = async (bucket, key, exact) => {
  const objects = await store.currentObjects(bucket, key, exact);
  for (let index = 0; index < objects.length; index += 1000)
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects.slice(index, index + 1000) },
      }),
    );
};
store.hasCurrentObjects = async (bucket, key, exact) =>
  (await store.currentObjects(bucket, key, exact)).length > 0;

const actions = await cleanupFixtures(manifest, store, flag === '--confirm');
const counts = actions.reduce((result, action) => {
  result[action.type] = (result[action.type] ?? 0) + 1;
  return result;
}, {});
console.log(
  JSON.stringify({
    runId: manifest.runId,
    mode: flag === '--confirm' ? 'cleaned' : 'dry-run',
    counts,
  }),
);
console.log(
  'DynamoDB point-in-time backups and noncurrent S3 object versions remain under configured retention.',
);
