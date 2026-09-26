import { describe, expect, it, vi } from 'vitest';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { Memory } from '../domain/memory.js';
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
