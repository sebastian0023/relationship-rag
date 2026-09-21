import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  chatTurnSchema,
  conversationSchema,
  conversationSummarySchema,
  type ChatTurn,
  type Conversation,
  type ConversationSummary,
} from '@relationship-rag/contracts';
import type { ConversationRepository } from '../application/ports.js';
import type { CanonicalMemoryLookup } from './bedrock-memory-retriever.js';

const userPartition = (coupleId: string, userId: string) => `COUPLE#${coupleId}#USER#${userId}`;
const conversationKey = (conversationId: string) => `CONVERSATION#${conversationId}`;
const turnKey = (conversationId: string, turn: ChatTurn) =>
  `CONVERSATION#${conversationId}#TURN#${turn.createdAt}#${turn.turnId}`;
const requestKey = (conversationId: string, requestId: string) =>
  `CONVERSATION#${conversationId}#REQUEST#${requestId}`;
const encode = (value: string | undefined) =>
  value === undefined ? undefined : Buffer.from(value).toString('base64url');
const decode = (value: string | undefined) =>
  value === undefined ? undefined : Buffer.from(value, 'base64url').toString();

export class DynamoDbConversationRepository implements ConversationRepository {
  private readonly client: DynamoDBDocumentClient;
  public constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  public async create(
    conversation: ConversationSummary,
    userId: string,
    coupleId: string,
  ): Promise<void> {
    const PK = userPartition(coupleId, userId);
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                PK,
                SK: conversationKey(conversation.conversationId),
                entityType: 'CONVERSATION',
                ...conversation,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                PK,
                SK: `CONVERSATION_CREATED#${conversation.createdAt}#${conversation.conversationId}`,
                entityType: 'CONVERSATION_LISTING',
                ...conversation,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  }

  public async renameIfNew(
    coupleId: string,
    userId: string,
    conversationId: string,
    title: string,
  ): Promise<void> {
    const PK = userPartition(coupleId, userId);
    const canonical = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK, SK: conversationKey(conversationId) },
        ConsistentRead: true,
      }),
    );
    const createdAt = canonical.Item?.['createdAt'];
    if (typeof createdAt !== 'string' || canonical.Item?.['title'] !== 'New conversation') return;
    const values = {
      ':new': 'New conversation',
      ':title': title,
      ':updatedAt': new Date().toISOString(),
    };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: { PK, SK: conversationKey(conversationId) },
              UpdateExpression: 'SET #title = :title, updatedAt = :updatedAt',
              ConditionExpression: '#title = :new',
              ExpressionAttributeNames: { '#title': 'title' },
              ExpressionAttributeValues: values,
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { PK, SK: `CONVERSATION_CREATED#${createdAt}#${conversationId}` },
              UpdateExpression: 'SET #title = :title, updatedAt = :updatedAt',
              ConditionExpression: '#title = :new',
              ExpressionAttributeNames: { '#title': 'title' },
              ExpressionAttributeValues: values,
            },
          },
        ],
      }),
    );
  }

  public async list(
    coupleId: string,
    userId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ readonly items: readonly ConversationSummary[]; readonly nextCursor?: string }> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': userPartition(coupleId, userId),
          ':prefix': 'CONVERSATION_CREATED#',
        },
        ScanIndexForward: false,
        Limit: limit,
        ...(decode(cursor) === undefined
          ? {}
          : { ExclusiveStartKey: { PK: userPartition(coupleId, userId), SK: decode(cursor) } }),
      }),
    );
    const items = (result.Items ?? []).map((item) => conversationSummarySchema.parse(item));
    const nextCursor =
      result.LastEvaluatedKey?.['SK'] === undefined
        ? undefined
        : encode(String(result.LastEvaluatedKey['SK']));
    return nextCursor === undefined ? { items } : { items, nextCursor };
  }

  public async get(
    coupleId: string,
    userId: string,
    conversationId: string,
    cursor?: string,
    limit = 20,
  ): Promise<Conversation | null> {
    const PK = userPartition(coupleId, userId);
    const conversation = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK, SK: conversationKey(conversationId) },
        ConsistentRead: true,
      }),
    );
    if (conversation.Item === undefined) return null;
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': PK, ':prefix': `CONVERSATION#${conversationId}#TURN#` },
        ScanIndexForward: false,
        Limit: limit,
        ...(decode(cursor) === undefined ? {} : { ExclusiveStartKey: { PK, SK: decode(cursor) } }),
      }),
    );
    return conversationSchema.parse({
      ...conversation.Item,
      turns: (result.Items ?? []).map((item) => chatTurnSchema.parse(item)),
      ...(result.LastEvaluatedKey?.['SK'] === undefined
        ? {}
        : { nextCursor: encode(String(result.LastEvaluatedKey['SK'])) }),
    });
  }

  public async findTurnByRequestId(
    coupleId: string,
    userId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ChatTurn | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: userPartition(coupleId, userId), SK: requestKey(conversationId, requestId) },
        ConsistentRead: true,
      }),
    );
    return result.Item === undefined ? null : chatTurnSchema.parse(result.Item);
  }

  public async reserveTurn(
    coupleId: string,
    userId: string,
    conversationId: string,
    turn: ChatTurn,
  ): Promise<void> {
    const PK = userPartition(coupleId, userId);
    const item = { PK, SK: turnKey(conversationId, turn), entityType: 'CHAT_TURN', ...turn };
    const request = {
      PK,
      SK: requestKey(conversationId, turn.requestId),
      entityType: 'CHAT_REQUEST',
      ...turn,
    };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          {
            Put: {
              TableName: this.tableName,
              Item: request,
              ConditionExpression: 'attribute_not_exists(PK) OR #status = :failed',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':failed': 'FAILED' },
            },
          },
        ],
      }),
    );
  }

  public async completeTurn(
    coupleId: string,
    userId: string,
    conversationId: string,
    turn: ChatTurn,
  ): Promise<void> {
    await this.writeTurn(coupleId, userId, conversationId, turn);
  }
  public async failTurn(
    coupleId: string,
    userId: string,
    conversationId: string,
    turn: ChatTurn,
  ): Promise<void> {
    await this.writeTurn(coupleId, userId, conversationId, turn);
  }
  private async writeTurn(
    coupleId: string,
    userId: string,
    conversationId: string,
    turn: ChatTurn,
  ): Promise<void> {
    const PK = userPartition(coupleId, userId);
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: { PK, SK: turnKey(conversationId, turn), entityType: 'CHAT_TURN', ...turn },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                PK,
                SK: requestKey(conversationId, turn.requestId),
                entityType: 'CHAT_REQUEST',
                ...turn,
              },
            },
          },
        ],
      }),
    );
  }
  public async completedTurns(
    coupleId: string,
    userId: string,
    conversationId: string,
    limit: number,
  ): Promise<readonly ChatTurn[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': userPartition(coupleId, userId),
          ':prefix': `CONVERSATION#${conversationId}#TURN#`,
          ':status': 'COMPLETED',
        },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => chatTurnSchema.parse(item)).reverse();
  }
}

export class DynamoDbCanonicalMemoryLookup implements CanonicalMemoryLookup {
  private readonly client: DynamoDBDocumentClient;
  public constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  public async find(coupleId: string, memoryId: string) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COUPLE#${coupleId}`, SK: `MEMORY_ID#${memoryId}` },
        ConsistentRead: true,
      }),
    );
    const item = result.Item;
    if (
      item === undefined ||
      typeof item['title'] !== 'string' ||
      typeof item['body'] !== 'string' ||
      typeof item['occurredOn'] !== 'string'
    )
      return null;
    const body = [
      `# ${item['title']}`,
      '',
      `Date: ${item['occurredOn']}`,
      `Language: ${item['locale']}`,
      ...(typeof item['location'] === 'string' ? [`Location: ${item['location']}`] : []),
      ...(typeof item['category'] === 'string' ? [`Category: ${item['category']}`] : []),
      ...(Array.isArray(item['tags']) && item['tags'].length > 0
        ? [`Tags: ${(item['tags'] as string[]).join(', ')}`]
        : []),
      '',
      item['body'],
      '',
    ].join('\n');
    return {
      memoryId,
      coupleId,
      title: item['title'],
      body: item['body'],
      fingerprint: createHash('sha256').update(body, 'utf8').digest('hex'),
    };
  }
}
