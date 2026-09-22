/* global console, process */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const value = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const tableName = process.env.APPLICATION_TABLE_NAME;
const queueUrl = process.env.DELIVERY_QUEUE_URL;
const coupleId = value('--couple-id');
const deliveryId = value('--delivery-id');
const confirmed = process.argv.includes('--confirm');
if (!tableName || !queueUrl || !coupleId || !deliveryId) {
  throw new Error(
    'APPLICATION_TABLE_NAME, DELIVERY_QUEUE_URL, --couple-id, and --delivery-id are required.',
  );
}
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const result = await dynamodb.send(
  new GetCommand({
    TableName: tableName,
    Key: { PK: `COUPLE#${coupleId}`, SK: `DELIVERY#${deliveryId}` },
    ConsistentRead: true,
  }),
);
if (result.Item === undefined) throw new Error('Delivery was not found.');
console.log(
  JSON.stringify({
    deliveryId,
    coupleId,
    status: result.Item.status,
    deliveryAt: result.Item.deliveryAt,
    action: confirmed ? 'enqueue' : 'dry-run',
  }),
);
if (result.Item.status === 'DELIVERED')
  throw new Error('Completed deliveries must not be replayed.');
if (confirmed) {
  await new SQSClient({}).send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ deliveryId, coupleId }),
    }),
  );
  console.log('Replay enqueued with the original delivery identifier.');
}
