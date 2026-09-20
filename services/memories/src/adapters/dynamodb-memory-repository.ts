import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { MemoryRepository } from '../application/memory-repository.js';
import type { Memory } from '../domain/memory.js';

const canonicalKey = (memory: Memory) => ({
  PK: `COUPLE#${memory.coupleId}`,
  SK: `MEMORY_ID#${memory.memoryId}`,
});
const timelineKey = (memory: Memory) => ({
  PK: `COUPLE#${memory.coupleId}`,
  SK: `MEMORY#${memory.occurredOn}#${memory.memoryId}`,
});
const toItem = (memory: Memory, keys: object) => ({ ...keys, entityType: 'MEMORY', ...memory });

export class DynamoDbMemoryRepository implements MemoryRepository {
  private readonly client: DynamoDBDocumentClient;
  public constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  public async create(memory: Memory): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: toItem(memory, canonicalKey(memory)),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: toItem(memory, timelineKey(memory)),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
  }
  public async update(memory: Memory, expectedVersion: number): Promise<void> {
    const old = await this.findById(memory.coupleId, memory.memoryId);
    if (old === null) throw new Error('Memory disappeared during update.');
    const versionCondition = {
      ConditionExpression: '#version = :version',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':version': expectedVersion },
    };
    const timelineWrite = {
      Put: {
        TableName: this.tableName,
        Item: toItem(memory, timelineKey(memory)),
        ...(old.occurredOn === memory.occurredOn
          ? versionCondition
          : { ConditionExpression: 'attribute_not_exists(PK)' }),
      },
    };
    const timelineMove =
      old.occurredOn === memory.occurredOn
        ? []
        : [{ Delete: { TableName: this.tableName, Key: timelineKey(old), ...versionCondition } }];
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: toItem(memory, canonicalKey(memory)),
              ...versionCondition,
            },
          },
          ...timelineMove,
          timelineWrite,
        ],
      }),
    );
  }
  public async findById(coupleId: string, memoryId: string): Promise<Memory | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COUPLE#${coupleId}`, SK: `MEMORY_ID#${memoryId}` },
        ConsistentRead: true,
      }),
    );
    return (result.Item as Memory | undefined) ?? null;
  }
  public async listTimeline(
    coupleId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ items: readonly Memory[]; nextCursor?: string }> {
    const exclusiveStartKey =
      cursor === undefined
        ? undefined
        : (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, string>);
    if (exclusiveStartKey !== undefined && exclusiveStartKey['PK'] !== `COUPLE#${coupleId}`)
      return { items: [] };
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `COUPLE#${coupleId}`, ':prefix': 'MEMORY#' },
        ScanIndexForward: false,
        Limit: limit,
        ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );
    const nextCursor =
      result.LastEvaluatedKey === undefined
        ? undefined
        : Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url');
    return {
      items: (result.Items ?? []) as Memory[],
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }
  public async delete(memory: Memory): Promise<void> {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: this.tableName,
              Key: canonicalKey(memory),
              ConditionExpression: '#version = :version',
              ExpressionAttributeNames: { '#version': 'version' },
              ExpressionAttributeValues: { ':version': memory.version },
            },
          },
          {
            Delete: {
              TableName: this.tableName,
              Key: timelineKey(memory),
              ConditionExpression: '#version = :version',
              ExpressionAttributeNames: { '#version': 'version' },
              ExpressionAttributeValues: { ':version': memory.version },
            },
          },
        ],
      }),
    );
  }
}
