import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { MemoryRepository } from '../application/memory-repository.js';
import type { Memory } from '../domain/memory.js';
import type { IngestionBatch, IngestionState, IngestionWork } from '../domain/ingestion.js';

const canonicalKey = (memory: Memory) => ({
  PK: `COUPLE#${memory.coupleId}`,
  SK: `MEMORY_ID#${memory.memoryId}`,
});
const timelineKey = (memory: Memory) => ({
  PK: `COUPLE#${memory.coupleId}`,
  SK: `MEMORY#${memory.occurredOn}#${memory.memoryId}`,
});
const toItem = (memory: Memory, keys: object) => ({ ...memory, ...keys, entityType: 'MEMORY' });
const fromItem = (item: Record<string, unknown>): Memory => {
  const { PK, SK, entityType, ...memory } = item;
  void PK;
  void SK;
  void entityType;
  return memory as unknown as Memory;
};
const ingestionKey = (coupleId: string, memoryId: string) => ({
  PK: `COUPLE#${coupleId}`,
  SK: `INGESTION#${memoryId}`,
});
const workKey = (coupleId: string, memoryId: string) => ({
  PK: `COUPLE#${coupleId}`,
  SK: `INGESTION_WORK#${memoryId}`,
});
const batchKey = (coupleId: string) => ({ PK: `COUPLE#${coupleId}`, SK: 'INGESTION_JOB' });

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
    return result.Item === undefined ? null : fromItem(result.Item);
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
      items: (result.Items ?? []).map(fromItem),
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

  public async getIngestion(coupleId: string, memoryId: string): Promise<IngestionState | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: ingestionKey(coupleId, memoryId),
        ConsistentRead: true,
      }),
    );
    return (result.Item as IngestionState | undefined) ?? null;
  }

  public async requestIngestion(work: IngestionWork): Promise<IngestionState> {
    const current = await this.getIngestion(work.coupleId, work.memoryId);
    if (
      current?.status === 'PENDING' &&
      current.fingerprint === work.fingerprint &&
      current.generation >= work.generation
    )
      return current;
    const state: IngestionState = {
      coupleId: work.coupleId,
      memoryId: work.memoryId,
      status: 'PENDING',
      generation: work.generation,
      ...(work.fingerprint === undefined ? {} : { fingerprint: work.fingerprint }),
      requestedAt: new Date().toISOString(),
      attempts: work.attempts,
    };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...ingestionKey(work.coupleId, work.memoryId),
                entityType: 'INGESTION',
                ...state,
              },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                ...workKey(work.coupleId, work.memoryId),
                entityType: 'INGESTION_WORK',
                ...work,
              },
            },
          },
        ],
      }),
    );
    return state;
  }

  public async completeIngestion(
    coupleId: string,
    memoryId: string,
    generation: number,
    status: 'INDEXED' | 'FAILED',
    failureCode?: string,
  ): Promise<void> {
    const values: Record<string, unknown> = {
      ':status': status,
      ':generation': generation,
      ':updatedAt': new Date().toISOString(),
      ...(failureCode === undefined ? {} : { ':failureCode': failureCode }),
    };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: ingestionKey(coupleId, memoryId),
              UpdateExpression:
                failureCode === undefined
                  ? 'SET #status = :status, indexedAt = :updatedAt REMOVE failureCode'
                  : 'SET #status = :status, indexedAt = :updatedAt, failureCode = :failureCode',
              ConditionExpression: 'generation = :generation',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: values,
            },
          },
          { Delete: { TableName: this.tableName, Key: workKey(coupleId, memoryId) } },
        ],
      }),
    );
  }

  public async listDueIngestionWork(
    coupleId: string,
    now: string,
    limit: number,
  ): Promise<readonly IngestionWork[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'nextAttemptAt <= :now',
        ExpressionAttributeValues: {
          ':pk': `COUPLE#${coupleId}`,
          ':prefix': 'INGESTION_WORK#',
          ':now': now,
        },
        Limit: limit,
      }),
    );
    return (result.Items ?? []) as IngestionWork[];
  }

  public async removeIngestionWork(coupleId: string, memoryId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: workKey(coupleId, memoryId) }),
    );
  }

  public async getIngestionBatch(coupleId: string): Promise<IngestionBatch | null> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: batchKey(coupleId), ConsistentRead: true }),
    );
    return (result.Item as IngestionBatch | undefined) ?? null;
  }

  public async saveIngestionBatch(coupleId: string, batch: IngestionBatch): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...batchKey(coupleId), entityType: 'INGESTION_BATCH', ...batch },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  public async clearIngestionBatch(coupleId: string, jobId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: batchKey(coupleId),
        ConditionExpression: 'jobId = :jobId',
        ExpressionAttributeValues: { ':jobId': jobId },
      }),
    );
  }
}
