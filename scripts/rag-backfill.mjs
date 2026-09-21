/* global process, console */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const stage = value('--stage');
const coupleId = value('--couple-id');
const tableName = process.env.APPLICATION_TABLE_NAME;
if (!['dev', 'test', 'prod'].includes(stage) || !coupleId || !tableName) {
  throw new Error(
    'Usage: APPLICATION_TABLE_NAME=<table> npm run rag:backfill -- --stage <dev|test|prod> --couple-id <id> [--confirm]',
  );
}
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
let cursor;
let count = 0;
do {
  const page = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `COUPLE#${coupleId}`, ':prefix': 'MEMORY_ID#' },
      ...(cursor ? { ExclusiveStartKey: cursor } : {}),
    }),
  );
  const memories = page.Items ?? [];
  count += memories.length;
  if (args.includes('--confirm')) {
    for (const memory of memories) {
      const memoryId = memory.memoryId;
      const requestedAt = new Date().toISOString();
      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: {
                  PK: `COUPLE#${coupleId}`,
                  SK: `INGESTION#${memoryId}`,
                  entityType: 'INGESTION',
                  coupleId,
                  memoryId,
                  status: 'PENDING',
                  generation: 1,
                  requestedAt,
                  attempts: 0,
                },
              },
            },
            {
              Put: {
                TableName: tableName,
                Item: {
                  PK: `COUPLE#${coupleId}`,
                  SK: `INGESTION_WORK#${memoryId}`,
                  entityType: 'INGESTION_WORK',
                  coupleId,
                  memoryId,
                  generation: 1,
                  operation: 'UPSERT',
                  attempts: 0,
                  nextAttemptAt: requestedAt,
                },
              },
            },
          ],
        }),
      );
    }
  }
  cursor = page.LastEvaluatedKey;
} while (cursor);
console.log(
  JSON.stringify({
    stage,
    coupleId,
    memories: count,
    mode: args.includes('--confirm') ? 'enqueued' : 'dry-run',
  }),
);
