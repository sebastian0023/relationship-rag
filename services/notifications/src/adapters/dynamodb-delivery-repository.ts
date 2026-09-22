import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  deliveryRecordSchema,
  inboxItemSchema,
  type DeliveryRecord,
  type InboxItem,
} from '@relationship-rag/contracts';
import type { DeliveryRepository } from '../application/delivery.js';

const deliveryKey = (coupleId: string, deliveryId: string) => ({
  PK: `COUPLE#${coupleId}`,
  SK: `DELIVERY#${deliveryId}`,
});
const workKey = (record: DeliveryRecord) => ({
  PK: `COUPLE#${record.coupleId}`,
  SK: `DELIVERY_WORK#${record.nextAttemptAt}#${record.deliveryId}`,
});
const inboxPartition = (userId: string) => `USER#${userId}`;
const encode = (key: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(key)).toString('base64url');
const decode = (cursor?: string): Record<string, unknown> | undefined =>
  cursor === undefined
    ? undefined
    : (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>);

export class DynamoDbDeliveryRepository implements DeliveryRepository {
  private readonly client: DynamoDBDocumentClient;
  public constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  public async get(coupleId: string, deliveryId: string): Promise<DeliveryRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: deliveryKey(coupleId, deliveryId),
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? null : deliveryRecordSchema.parse(result.Item);
  }
  public async recipientActive(coupleId: string, recipientUserId: string): Promise<boolean> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COUPLE#${coupleId}`, SK: `MEMBER#${recipientUserId}` },
        ConsistentRead: true,
      }),
    );
    return result.Item?.['status'] === 'ACTIVE';
  }
  public async deliver(
    record: DeliveryRecord,
    deliveredAt: string,
  ): Promise<'DELIVERED' | 'ALREADY_DELIVERED'> {
    const item: InboxItem = {
      cardId: record.cardId,
      deliveryId: record.deliveryId,
      senderUserId: record.senderUserId,
      senderDisplayName: record.senderDisplayName,
      recipientUserId: record.recipientUserId,
      occasion: record.occasion,
      tone: record.tone,
      locale: record.locale,
      title: record.title,
      body: record.body,
      citedMemoryIds: record.citedMemoryIds,
      deliveredAt,
    };
    const PK = inboxPartition(record.recipientUserId);
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: { PK, SK: `INBOX_CARD#${record.cardId}`, entityType: 'INBOX', ...item },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK,
                  SK: `INBOX#${deliveredAt}#${record.cardId}`,
                  entityType: 'INBOX',
                  ...item,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: deliveryKey(record.coupleId, record.deliveryId),
                UpdateExpression: 'SET #status = :delivered, deliveredAt = :at',
                ConditionExpression: '#status <> :delivered',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':delivered': 'DELIVERED', ':at': deliveredAt },
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: {
                  PK: `COUPLE#${record.coupleId}#USER#${record.senderUserId}`,
                  SK: `CARD#${record.cardId}`,
                },
                UpdateExpression:
                  'SET #status = :sent, deliveredAt = :at, updatedAt = :at ADD #version :one',
                ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
                ExpressionAttributeValues: { ':sent': 'SENT', ':at': deliveredAt, ':one': 1 },
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: {
                  PK: `COUPLE#${record.coupleId}#USER#${record.senderUserId}`,
                  SK: `CARD_CREATED#${record.cardCreatedAt}#${record.cardId}`,
                },
                UpdateExpression:
                  'SET #status = :sent, deliveredAt = :at, updatedAt = :at ADD #version :one',
                ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
                ExpressionAttributeValues: { ':sent': 'SENT', ':at': deliveredAt, ':one': 1 },
              },
            },
            { Delete: { TableName: this.tableName, Key: workKey(record) } },
          ],
        }),
      );
      return 'DELIVERED';
    } catch (error) {
      if ((await this.get(record.coupleId, record.deliveryId))?.status === 'DELIVERED')
        return 'ALREADY_DELIVERED';
      throw error;
    }
  }
  public async listInbox(recipientUserId: string, cursor?: string, limit = 20) {
    const PK = inboxPartition(recipientUserId);
    const start = decode(cursor);
    if (start !== undefined && start['PK'] !== PK) return { items: [] };
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': PK, ':prefix': 'INBOX#' },
        ScanIndexForward: false,
        Limit: limit,
        ...(start === undefined ? {} : { ExclusiveStartKey: start }),
      }),
    );
    return {
      items: (result.Items ?? []).map((item) => inboxItemSchema.parse(item)),
      ...(result.LastEvaluatedKey === undefined
        ? {}
        : { nextCursor: encode(result.LastEvaluatedKey) }),
    };
  }
  public async getInbox(recipientUserId: string, cardId: string): Promise<InboxItem | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: inboxPartition(recipientUserId), SK: `INBOX_CARD#${cardId}` },
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? null : inboxItemSchema.parse(result.Item);
  }
  public async markRead(
    recipientUserId: string,
    cardId: string,
    readAt: string,
  ): Promise<InboxItem> {
    const item = await this.getInbox(recipientUserId, cardId);
    if (item === null) throw new Error('Inbox item disappeared.');
    if (item.readAt !== undefined) return item;
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { PK: inboxPartition(recipientUserId), SK: `INBOX_CARD#${cardId}` },
              UpdateExpression: 'SET readAt = if_not_exists(readAt, :at)',
              ExpressionAttributeValues: { ':at': readAt },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: {
                PK: inboxPartition(recipientUserId),
                SK: `INBOX#${item.deliveredAt}#${cardId}`,
              },
              UpdateExpression: 'SET readAt = if_not_exists(readAt, :at)',
              ExpressionAttributeValues: { ':at': readAt },
            },
          },
        ],
      }),
    );
    return { ...item, readAt };
  }
  public async dueWork(
    coupleId: string,
    now: string,
    limit: number,
  ): Promise<readonly DeliveryRecord[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': `COUPLE#${coupleId}`,
          ':start': 'DELIVERY_WORK#',
          ':end': `DELIVERY_WORK#${now}~`,
        },
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => deliveryRecordSchema.parse(item));
  }
  public async dispatched(record: DeliveryRecord): Promise<void> {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: deliveryKey(record.coupleId, record.deliveryId),
                UpdateExpression: 'SET #status = :status',
                ConditionExpression: '#status = :pending',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: { ':status': 'DISPATCHED', ':pending': 'PENDING' },
              },
            },
            { Delete: { TableName: this.tableName, Key: workKey(record) } },
          ],
        }),
      );
    } catch (error) {
      const current = await this.get(record.coupleId, record.deliveryId);
      if (current?.status !== 'DELIVERED' && current?.status !== 'DISPATCHED') throw error;
      await this.client.send(
        new DeleteCommand({ TableName: this.tableName, Key: workKey(record) }),
      );
    }
  }
  public async retry(record: DeliveryRecord, nextAttemptAt: string): Promise<void> {
    const current = await this.get(record.coupleId, record.deliveryId);
    if (current?.status === 'DELIVERED' || current?.status === 'DISPATCHED') {
      await this.client.send(
        new DeleteCommand({ TableName: this.tableName, Key: workKey(record) }),
      );
      return;
    }
    const retried = { ...record, attempts: record.attempts + 1, nextAttemptAt };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: this.tableName, Key: workKey(record) } },
          {
            Put: {
              TableName: this.tableName,
              Item: { ...workKey(retried), entityType: 'DELIVERY_WORK', ...retried },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: deliveryKey(record.coupleId, record.deliveryId),
              UpdateExpression: 'SET attempts = :attempts, nextAttemptAt = :next',
              ExpressionAttributeValues: { ':attempts': retried.attempts, ':next': nextAttemptAt },
            },
          },
        ],
      }),
    );
  }
  public async fail(coupleId: string, deliveryId: string, failureCode: string): Promise<void> {
    const record = await this.get(coupleId, deliveryId);
    if (record === null) return;
    if (record.status === 'DELIVERED') {
      await this.client.send(
        new DeleteCommand({ TableName: this.tableName, Key: workKey(record) }),
      );
      return;
    }
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: deliveryKey(coupleId, deliveryId),
              UpdateExpression: 'SET #status = :failed, failureCode = :code',
              ConditionExpression: '#status <> :delivered',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':failed': 'FAILED',
                ':delivered': 'DELIVERED',
                ':code': failureCode,
              },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: {
                PK: `COUPLE#${coupleId}#USER#${record.senderUserId}`,
                SK: `CARD#${record.cardId}`,
              },
              UpdateExpression: 'SET #status = :failed, updatedAt = :at ADD #version :one',
              ConditionExpression: '#status <> :sent',
              ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
              ExpressionAttributeValues: {
                ':failed': 'DELIVERY_FAILED',
                ':sent': 'SENT',
                ':at': new Date().toISOString(),
                ':one': 1,
              },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: {
                PK: `COUPLE#${coupleId}#USER#${record.senderUserId}`,
                SK: `CARD_CREATED#${record.cardCreatedAt}#${record.cardId}`,
              },
              UpdateExpression: 'SET #status = :failed, updatedAt = :at ADD #version :one',
              ConditionExpression: '#status <> :sent',
              ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
              ExpressionAttributeValues: {
                ':failed': 'DELIVERY_FAILED',
                ':sent': 'SENT',
                ':at': new Date().toISOString(),
                ':one': 1,
              },
            },
          },
          { Delete: { TableName: this.tableName, Key: workKey(record) } },
        ],
      }),
    );
  }
}
