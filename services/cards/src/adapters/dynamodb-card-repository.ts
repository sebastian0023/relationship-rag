import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CardRecipient, DeliveryRecord, SendCardResponse } from '@relationship-rag/contracts';
import { ConflictError } from '@relationship-rag/domain';
import type { CardRepository, SelectedMemory } from '../application/ports.js';
import type { Card } from '../domain/card.js';

const senderPartition = (coupleId: string, senderUserId: string) =>
  `COUPLE#${coupleId}#USER#${senderUserId}`;
const canonicalKey = (card: Card) => ({
  PK: senderPartition(card.coupleId, card.senderUserId),
  SK: `CARD#${card.cardId}`,
});
const projectionKey = (card: Card) => ({
  PK: senderPartition(card.coupleId, card.senderUserId),
  SK: `CARD_CREATED#${card.createdAt}#${card.cardId}`,
});
const cardItem = (card: Card, key: object) => ({ ...key, entityType: 'CARD', ...card });
const encode = (key: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(key)).toString('base64url');
const decode = (cursor?: string): Record<string, unknown> | undefined =>
  cursor === undefined
    ? undefined
    : (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>);
const rethrowConflict = (error: unknown): never => {
  if (
    (error as { name?: string }).name === 'TransactionCanceledException' ||
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  )
    throw new ConflictError();
  throw error;
};

export class DynamoDbCardRepository implements CardRepository {
  private readonly client: DynamoDBDocumentClient;
  public constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  public async recipients(
    coupleId: string,
    senderUserId: string,
  ): Promise<readonly CardRecipient[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `COUPLE#${coupleId}`,
          ':prefix': 'MEMBER#',
          ':active': 'ACTIVE',
        },
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: { '#status': 'status' },
        ConsistentRead: true,
      }),
    );
    return (result.Items ?? []).flatMap((item) =>
      typeof item['userId'] === 'string' &&
      item['userId'] !== senderUserId &&
      typeof item['displayName'] === 'string'
        ? [{ userId: item['userId'], displayName: item['displayName'] }]
        : [],
    );
  }

  public async memories(
    coupleId: string,
    memoryIds: readonly string[],
  ): Promise<readonly SelectedMemory[]> {
    const results = await Promise.all(
      memoryIds.map(async (memoryId) => {
        const result = await this.client.send(
          new GetCommand({
            TableName: this.tableName,
            Key: { PK: `COUPLE#${coupleId}`, SK: `MEMORY_ID#${memoryId}` },
            ConsistentRead: true,
          }),
        );
        const item = result.Item;
        return item !== undefined &&
          typeof item['title'] === 'string' &&
          typeof item['body'] === 'string' &&
          typeof item['occurredOn'] === 'string'
          ? { memoryId, title: item['title'], body: item['body'], occurredOn: item['occurredOn'] }
          : null;
      }),
    );
    return results.filter((memory): memory is SelectedMemory => memory !== null);
  }

  public async findByClientRequest(
    coupleId: string,
    senderUserId: string,
    requestId: string,
  ): Promise<Card | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: senderPartition(coupleId, senderUserId), SK: `CARD_REQUEST#${requestId}` },
        ConsistentRead: true,
      }),
    );
    if (typeof result.Item?.['cardId'] !== 'string') return null;
    return this.find(coupleId, senderUserId, result.Item['cardId']);
  }

  public async create(card: Card, clientRequestId: string): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: cardItem(card, canonicalKey(card)),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: cardItem(card, projectionKey(card)),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                PK: senderPartition(card.coupleId, card.senderUserId),
                SK: `CARD_REQUEST#${clientRequestId}`,
                entityType: 'CARD_REQUEST',
                cardId: card.cardId,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  }

  public async find(coupleId: string, senderUserId: string, cardId: string): Promise<Card | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: senderPartition(coupleId, senderUserId), SK: `CARD#${cardId}` },
        ConsistentRead: true,
      }),
    );
    return (result.Item as Card | undefined) ?? null;
  }

  public async list(coupleId: string, senderUserId: string, cursor?: string, limit = 20) {
    const PK = senderPartition(coupleId, senderUserId);
    const start = decode(cursor);
    if (start !== undefined && start['PK'] !== PK) return { items: [] };
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': PK, ':prefix': 'CARD_CREATED#' },
        ScanIndexForward: false,
        Limit: limit,
        ...(start === undefined ? {} : { ExclusiveStartKey: start }),
      }),
    );
    return {
      items: (result.Items ?? []) as unknown as Card[],
      ...(result.LastEvaluatedKey === undefined
        ? {}
        : { nextCursor: encode(result.LastEvaluatedKey) }),
    };
  }

  public async update(card: Card, expectedVersion: number): Promise<void> {
    const condition = {
      ConditionExpression: '#version = :version AND #status = :draft',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: { ':version': expectedVersion, ':draft': 'DRAFT' },
    };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: cardItem(card, canonicalKey(card)),
                ...condition,
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: cardItem(card, projectionKey(card)),
                ...condition,
              },
            },
          ],
        }),
      );
    } catch (error) {
      rethrowConflict(error);
    }
  }

  public async delete(card: Card, expectedVersion: number): Promise<void> {
    const condition = {
      ConditionExpression: '#version = :version AND #status = :draft',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: { ':version': expectedVersion, ':draft': 'DRAFT' },
    };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: this.tableName, Key: canonicalKey(card), ...condition } },
            { Delete: { TableName: this.tableName, Key: projectionKey(card), ...condition } },
          ],
        }),
      );
    } catch (error) {
      rethrowConflict(error);
    }
  }

  public async findSendRequest(coupleId: string, senderUserId: string, idempotencyKey: string) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COUPLE#${coupleId}`, SK: `SEND_REQUEST#${senderUserId}#${idempotencyKey}` },
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    return item === undefined
      ? null
      : {
          fingerprint: String(item['fingerprint']),
          response: item['response'] as SendCardResponse,
        };
  }

  public async approve(
    original: Card,
    approved: Card,
    deliveryId: string,
    idempotencyKey: string,
    fingerprint: string,
    senderDisplayName: string,
  ): Promise<SendCardResponse> {
    const response: SendCardResponse = {
      deliveryId,
      cardId: approved.cardId,
      status: approved.status === 'SCHEDULED' ? 'SCHEDULED' : 'QUEUED',
      deliveryAt: approved.deliveryAt ?? approved.updatedAt,
    };
    const delivery: DeliveryRecord = {
      deliveryId,
      coupleId: approved.coupleId,
      cardId: approved.cardId,
      senderUserId: approved.senderUserId,
      senderDisplayName,
      recipientUserId: approved.recipientUserId,
      cardCreatedAt: approved.createdAt,
      occasion: approved.occasion,
      tone: approved.tone,
      locale: approved.locale,
      title: approved.title,
      body: approved.body,
      citedMemoryIds: [...approved.citedMemoryIds],
      deliveryAt: response.deliveryAt,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: approved.updatedAt,
    };
    const condition = {
      ConditionExpression: '#version = :version AND #status = :draft',
      ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
      ExpressionAttributeValues: { ':version': original.version, ':draft': 'DRAFT' },
    };
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: cardItem(approved, canonicalKey(approved)),
                ...condition,
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: cardItem(approved, projectionKey(approved)),
                ...condition,
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: `COUPLE#${approved.coupleId}`,
                  SK: `DELIVERY#${deliveryId}`,
                  entityType: 'DELIVERY',
                  ...delivery,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: `COUPLE#${approved.coupleId}`,
                  SK: `DELIVERY_WORK#${delivery.nextAttemptAt}#${deliveryId}`,
                  entityType: 'DELIVERY_WORK',
                  ...delivery,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: `COUPLE#${approved.coupleId}`,
                  SK: `SEND_REQUEST#${approved.senderUserId}#${idempotencyKey}`,
                  entityType: 'SEND_REQUEST',
                  fingerprint,
                  response,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      rethrowConflict(error);
    }
    return response;
  }

  public async senderDisplayName(coupleId: string, senderUserId: string): Promise<string | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COUPLE#${coupleId}`, SK: `MEMBER#${senderUserId}` },
        ConsistentRead: true,
      }),
    );
    return result.Item?.['status'] === 'ACTIVE' && typeof result.Item['displayName'] === 'string'
      ? result.Item['displayName']
      : null;
  }
}
