import { describe, expect, it, vi } from 'vitest';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { Memory } from '../domain/memory.js';
import { DomainError } from '@relationship-rag/domain';
import { DynamoDbMemoryRepository } from './dynamodb-memory-repository.js';

const memory: Memory = {
  memoryId: 'memory-1',
  coupleId: 'couple-1',
  createdBy: 'owner-1',
  title: 'Synthetic picnic',
  occurredOn: '2025-05-10',
  body: 'Synthetic test memory.',
  locale: 'en',
  tags: [],
  createdAt: '2025-05-10T12:00:00.000Z',
  updatedAt: '2025-05-10T12:00:00.000Z',
  version: 1,
  photos: [],
  ingestionStatus: 'PENDING',
};
const canonical = { PK: 'COUPLE#couple-1', SK: 'MEMORY_ID#memory-1' };
const timeline = { PK: 'COUPLE#couple-1', SK: 'MEMORY#2025-05-10#memory-1' };

describe('DynamoDbMemoryRepository', () => {
  it('moves a changed date atomically and rejects a foreign timeline cursor', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetCommand)
        return { Item: { ...memory, ...canonical, entityType: 'MEMORY' } };
      if (command instanceof TransactWriteCommand) return {};
      if (command instanceof QueryCommand) return { Items: [], LastEvaluatedKey: timeline };
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbMemoryRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    await repository.update({ ...memory, occurredOn: '2025-06-01', version: 2 }, 1);
    const transaction = send.mock.calls[1]?.[0] as TransactWriteCommand;
    expect(
      transaction.input.TransactItems?.map((item) => item.Delete?.Key ?? item.Put?.Item),
    ).toEqual([
      expect.objectContaining(canonical),
      timeline,
      expect.objectContaining({ SK: 'MEMORY#2025-06-01#memory-1', version: 2 }),
    ]);
    const foreignCursor = Buffer.from(
      JSON.stringify({ PK: 'COUPLE#other', SK: timeline.SK }),
    ).toString('base64url');
    await expect(repository.listTimeline('couple-1', foreignCursor)).rejects.toBeInstanceOf(
      DomainError,
    );
    const forgedCursor = Buffer.from(
      JSON.stringify({ PK: 'COUPLE#couple-1', SK: 'MEMBER#owner-1' }),
    ).toString('base64url');
    await expect(repository.listTimeline('couple-1', forgedCursor)).rejects.toBeInstanceOf(
      DomainError,
    );
    const page = await repository.listTimeline('couple-1', undefined, 1);
    expect(page.nextCursor).toBeTruthy();
  });

  it('creates and deletes canonical and chronological rows together', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof TransactWriteCommand) return {};
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbMemoryRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    await repository.create(memory);
    await repository.delete(memory);
    const creation = send.mock.calls[0]?.[0] as TransactWriteCommand;
    const deletion = send.mock.calls[1]?.[0] as TransactWriteCommand;
    expect(creation.input.TransactItems?.map((item) => item.Put?.Item?.['SK'])).toEqual([
      canonical.SK,
      timeline.SK,
    ]);
    expect(deletion.input.TransactItems?.map((item) => item.Delete?.Key?.['SK'])).toEqual([
      canonical.SK,
      timeline.SK,
    ]);
    expect(deletion.input.TransactItems?.[0]?.Delete?.ConditionExpression).toContain('version');
  });

  it('tracks ingestion generations and bounded due work with exact keys', async () => {
    const state: { current?: Record<string, unknown> } = {};
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetCommand) {
        const sk = command.input.Key?.['SK'];
        return sk === 'INGESTION#memory-1' ? { Item: state.current } : {};
      }
      if (command instanceof TransactWriteCommand) return {};
      if (command instanceof QueryCommand)
        return { Items: [{ memoryId: 'memory-1', generation: 1 }] };
      if (command instanceof DeleteCommand || command instanceof PutCommand) return {};
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbMemoryRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    const work = {
      coupleId: 'couple-1',
      memoryId: 'memory-1',
      generation: 1,
      fingerprint: 'fingerprint-1',
      operation: 'UPSERT' as const,
      attempts: 0,
      nextAttemptAt: '2025-05-10T12:00:00.000Z',
    };
    const requested = await repository.requestIngestion(work);
    expect(requested).toMatchObject({ status: 'PENDING', generation: 1 });
    const transaction = send.mock.calls.find(
      ([command]) => command instanceof TransactWriteCommand,
    )?.[0] as TransactWriteCommand;
    expect(transaction.input.TransactItems?.map((item) => item.Put?.Item?.['SK'])).toEqual([
      'INGESTION#memory-1',
      'INGESTION_WORK#memory-1',
    ]);
    state.current = requested;
    const before = send.mock.calls.length;
    expect(await repository.requestIngestion(work)).toEqual(requested);
    expect(send.mock.calls.length).toBe(before + 1);
    expect(
      await repository.listDueIngestionWork('couple-1', '2025-05-10T12:01:00.000Z', 25),
    ).toHaveLength(1);
    const query = send.mock.calls.at(-1)?.[0] as QueryCommand;
    expect(query.input.KeyConditionExpression).toContain('begins_with');
    expect(query.input.FilterExpression).toContain('nextAttemptAt');
    await repository.removeIngestionWork('couple-1', 'memory-1');
    await repository.saveIngestionBatch('couple-1', { jobId: 'job-1' } as never);
    await repository.clearIngestionBatch('couple-1', 'job-1');
  });
  it('completes successful ingestion without marshalling an undefined failure code', async () => {
    const send = vi.fn(async (_command: unknown) => ({}));
    const repository = new DynamoDbMemoryRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);

    await repository.completeIngestion('couple-1', 'memory-1', 2, 'INDEXED');

    const transaction = send.mock.calls[0]?.[0] as TransactWriteCommand;
    const update = transaction.input.TransactItems?.[0]?.Update;
    expect(update?.UpdateExpression).toContain('REMOVE failureCode');
    expect(update?.ExpressionAttributeValues).toEqual({
      ':status': 'INDEXED',
      ':generation': 2,
      ':updatedAt': expect.any(String),
    });
    expect(transaction.input.TransactItems?.[1]?.Delete?.Key).toEqual({
      PK: 'COUPLE#couple-1',
      SK: 'INGESTION_WORK#memory-1',
    });
  });

  it('keeps storage keys out of domain memories and writes distinct rows on update', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetCommand)
        return { Item: { ...memory, ...canonical, entityType: 'MEMORY' } };
      if (command instanceof QueryCommand)
        return { Items: [{ ...memory, ...timeline, entityType: 'MEMORY' }] };
      if (command instanceof TransactWriteCommand) return {};
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbMemoryRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);

    const found = await repository.findById('couple-1', memory.memoryId);
    expect(found).toEqual(memory);
    expect((await repository.listTimeline('couple-1')).items).toEqual([memory]);
    await repository.update({ ...found!, version: 2 }, 1);

    const transaction = send.mock.calls.find(
      ([command]) => command instanceof TransactWriteCommand,
    )?.[0] as TransactWriteCommand;
    const puts = transaction.input.TransactItems?.map((item) => item.Put?.Item);
    expect(puts).toEqual([
      expect.objectContaining({ ...canonical, version: 2 }),
      expect.objectContaining({ ...timeline, version: 2 }),
    ]);
    expect(puts?.[0]?.['SK']).not.toBe(puts?.[1]?.['SK']);
  });
});
