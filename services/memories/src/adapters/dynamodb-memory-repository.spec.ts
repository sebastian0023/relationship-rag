import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDbMemoryRepository } from './dynamodb-memory-repository.js';

describe('ingestion completion persistence', () => {
  it('completes successful ingestion without undefined DynamoDB values and removes stale failure state', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbMemoryRepository('synthetic-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    await repository.completeIngestion('synthetic-couple', 'synthetic-memory', 2, 'INDEXED');
    const update = send.mock.calls[0]![0].input.TransactItems[0].Update;
    expect(update.ExpressionAttributeValues).not.toHaveProperty(':failureCode');
    expect(update.UpdateExpression).toContain('REMOVE failureCode');
    expect(update.ConditionExpression).toBe('generation = :generation');
  });
  it('persists an enumerated failure code and retains the generation guard', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbMemoryRepository('synthetic-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    await repository.completeIngestion(
      'synthetic-couple',
      'synthetic-memory',
      2,
      'FAILED',
      'INGESTION_FAILED',
    );
    const update = send.mock.calls[0]![0].input.TransactItems[0].Update;
    expect(update.ExpressionAttributeValues[':failureCode']).toBe('INGESTION_FAILED');
    expect(update.ConditionExpression).toBe('generation = :generation');
  });
});

import type { Memory } from '../domain/memory.js';
import type { IngestionWork } from '../domain/ingestion.js';
const memory: Memory = {
  memoryId: 'memory',
  coupleId: 'couple',
  createdBy: 'owner',
  title: 'Synthetic',
  body: 'A fixture',
  occurredOn: '2025-01-01',
  locale: 'en',
  tags: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  version: 1,
  photos: [],
  ingestionStatus: 'PENDING',
};
const work: IngestionWork = {
  coupleId: 'couple',
  memoryId: 'memory',
  generation: 1,
  fingerprint: 'hash',
  operation: 'UPSERT',
  attempts: 0,
  nextAttemptAt: '2025-01-01T00:00:00Z',
};
const fixture = () => {
  const send = vi.fn().mockResolvedValue({});
  return {
    send,
    repository: new DynamoDbMemoryRepository('synthetic-table', {
      send,
    } as unknown as DynamoDBDocumentClient),
  };
};
describe('canonical memory persistence boundaries', () => {
  it('rejects a foreign timeline cursor before accessing DynamoDB and round-trips local cursors', async () => {
    const { send, repository } = fixture();
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(await repository.listTimeline('couple', encode({ PK: 'COUPLE#foreign' }))).toEqual({
      items: [],
    });
    expect(send).not.toHaveBeenCalled();
    expect(await repository.listTimeline('couple')).toEqual({ items: [] });
    const key = { PK: 'COUPLE#couple', SK: 'MEMORY#2025-01-01#memory' };
    send.mockResolvedValueOnce({ Items: [memory], LastEvaluatedKey: key });
    const page = await repository.listTimeline('couple', encode(key), 10);
    expect(page.items).toEqual([memory]);
    expect(page.nextCursor).toBe(encode(key));
    expect(send.mock.calls.at(-1)![0].input).toMatchObject({
      ExclusiveStartKey: key,
      Limit: 10,
      ScanIndexForward: false,
    });
  });
  it('atomically moves the timeline projection when the date changes and guards versions', async () => {
    const { send, repository } = fixture();
    await repository.create(memory);
    expect(send.mock.calls[0]![0].input.TransactItems).toHaveLength(2);
    for (const date of [memory.occurredOn, '2025-02-01']) {
      send.mockResolvedValueOnce({ Item: memory }).mockResolvedValueOnce({});
      await repository.update({ ...memory, occurredOn: date, version: 2 }, 1);
      const writes = send.mock.calls.at(-1)![0].input.TransactItems;
      expect(writes).toHaveLength(date === memory.occurredOn ? 2 : 3);
      expect(writes[0].Put.ConditionExpression).toBe('#version = :version');
    }
    await expect(repository.update(memory, 1)).rejects.toThrow('disappeared');
    await repository.delete(memory);
    expect(send.mock.calls.at(-1)![0].input.TransactItems[0].Delete).toMatchObject({
      Key: { PK: 'COUPLE#couple', SK: 'MEMORY_ID#memory' },
      ConditionExpression: '#version = :version',
    });
  });
  it('reuses pending identical ingestion but advances changed fingerprints or generations', async () => {
    const { send, repository } = fixture();
    const pending = { ...work, status: 'PENDING' };
    send.mockResolvedValueOnce({ Item: pending });
    expect(await repository.requestIngestion(work)).toEqual(pending);
    expect(send).toHaveBeenCalledTimes(1);
    for (const current of [
      undefined,
      { ...pending, status: 'FAILED' },
      { ...pending, fingerprint: 'old' },
      { ...pending, generation: 0 },
    ]) {
      send.mockResolvedValueOnce(current ? { Item: current } : {}).mockResolvedValueOnce({});
      expect(await repository.requestIngestion(work)).toMatchObject({
        generation: 1,
        status: 'PENDING',
        fingerprint: 'hash',
      });
      expect(send.mock.calls.at(-1)![0].input.TransactItems).toHaveLength(2);
    }
    const deletion: IngestionWork = {
      coupleId: work.coupleId,
      memoryId: work.memoryId,
      generation: work.generation,
      operation: 'DELETE',
      attempts: 0,
      nextAttemptAt: work.nextAttemptAt,
    };
    expect(
      await repository.requestIngestion({ ...deletion, operation: 'DELETE' }),
    ).not.toHaveProperty('fingerprint');
  });
  it('uses bounded due-work queries and exact batch keys', async () => {
    const { send, repository } = fixture();
    expect(await repository.listDueIngestionWork('couple', '2025-01-01T00:00:00Z', 25)).toEqual([]);
    send.mockResolvedValueOnce({ Items: [work] });
    expect(await repository.listDueIngestionWork('couple', '2025-01-01T00:00:00Z', 25)).toEqual([
      work,
    ]);
    expect(send.mock.calls.at(-1)![0].input).toMatchObject({
      Limit: 25,
      ExpressionAttributeValues: { ':pk': 'COUPLE#couple', ':prefix': 'INGESTION_WORK#' },
    });
    expect(await repository.getIngestionBatch('couple')).toBeNull();
    const batch = {
      jobId: 'job',
      startedAt: '2025-01-01T00:00:00Z',
      items: [{ memoryId: 'memory', generation: 1 }],
    };
    send.mockResolvedValueOnce({ Item: batch });
    expect(await repository.getIngestionBatch('couple')).toEqual(batch);
    await repository.saveIngestionBatch('couple', batch);
    expect(send.mock.calls.at(-1)![0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
    await repository.clearIngestionBatch('couple', 'job');
    expect(send.mock.calls.at(-1)![0].input.ConditionExpression).toBe('jobId = :jobId');
    await repository.removeIngestionWork('couple', 'memory');
    expect(send.mock.calls.at(-1)![0].input.Key).toEqual({
      PK: 'COUPLE#couple',
      SK: 'INGESTION_WORK#memory',
    });
  });
});
