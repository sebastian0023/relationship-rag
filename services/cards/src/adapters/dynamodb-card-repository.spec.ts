import { describe, expect, it, vi } from 'vitest';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { Card } from '../domain/card.js';
import { ConflictError, DomainError } from '@relationship-rag/domain';
import { DynamoDbCardRepository } from './dynamodb-card-repository.js';

const card: Card = {
  cardId: 'card-1',
  coupleId: 'couple-1',
  senderUserId: 'owner-1',
  recipientUserId: 'partner-1',
  recipientDisplayName: 'Partner',
  status: 'DRAFT',
  occasion: 'Synthetic picnic',
  tone: 'GRATEFUL',
  locale: 'en',
  memoryIds: [],
  citedMemoryIds: [],
  title: 'Test card',
  body: 'Synthetic card body.',
  version: 1,
  createdAt: '2025-05-10T12:00:00.000Z',
  updatedAt: '2025-05-10T12:00:00.000Z',
};
const canonical = { PK: 'COUPLE#couple-1#USER#owner-1', SK: 'CARD#card-1' };
const projection = {
  PK: 'COUPLE#couple-1#USER#owner-1',
  SK: 'CARD_CREATED#2025-05-10T12:00:00.000Z#card-1',
};

describe('DynamoDbCardRepository', () => {
  it('queries only the couple membership and requested canonical memories', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof QueryCommand)
        return {
          Items: [
            { userId: 'owner-1', displayName: 'Owner' },
            { userId: 'partner-1', displayName: 'Partner' },
            { userId: 'missing-name' },
          ],
        };
      if (command instanceof GetCommand)
        return command.input.Key?.['SK'] === 'MEMORY_ID#memory-1'
          ? { Item: { title: 'Picnic', body: 'A synthetic picnic.', occurredOn: '2025-05-10' } }
          : {};
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbCardRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    expect(await repository.recipients('couple-1', 'owner-1')).toEqual([
      { userId: 'partner-1', displayName: 'Partner' },
    ]);
    expect(await repository.memories('couple-1', ['memory-1', 'missing'])).toEqual([
      {
        memoryId: 'memory-1',
        title: 'Picnic',
        body: 'A synthetic picnic.',
        occurredOn: '2025-05-10',
      },
    ]);
    const query = send.mock.calls[0]?.[0] as QueryCommand;
    expect(query.input.ExpressionAttributeValues?.[':pk']).toBe('COUPLE#couple-1');
    const gets = send.mock.calls
      .slice(1)
      .map(([command]) => (command as GetCommand).input.Key?.['PK']);
    expect(gets).toEqual(['COUPLE#couple-1', 'COUPLE#couple-1']);
  });

  it('creates draft and request rows, scopes pagination, and resolves idempotent saves', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof TransactWriteCommand) return {};
      if (command instanceof QueryCommand)
        return {
          Items: [{ ...card, ...projection, entityType: 'CARD' }],
          LastEvaluatedKey: projection,
        };
      if (command instanceof GetCommand)
        return command.input.Key?.['SK'] === 'CARD_REQUEST#request-1'
          ? { Item: { cardId: card.cardId } }
          : { Item: { ...card, ...canonical, entityType: 'CARD' } };
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbCardRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    await repository.create(card, 'request-1');
    const transaction = send.mock.calls[0]?.[0] as TransactWriteCommand;
    expect(transaction.input.TransactItems?.map((item) => item.Put?.Item?.['SK'])).toEqual([
      canonical.SK,
      projection.SK,
      'CARD_REQUEST#request-1',
    ]);
    expect(await repository.findByClientRequest('couple-1', 'owner-1', 'request-1')).toEqual(card);
    const page = await repository.list('couple-1', 'owner-1', undefined, 1);
    expect(page.items).toEqual([card]);
    expect(page.nextCursor).toBeTruthy();
    const foreignCursor = Buffer.from(
      JSON.stringify({ PK: 'COUPLE#other#USER#owner-1', SK: projection.SK }),
    ).toString('base64url');
    await expect(repository.list('couple-1', 'owner-1', foreignCursor)).rejects.toBeInstanceOf(
      DomainError,
    );
    const forgedCursor = Buffer.from(
      JSON.stringify({ PK: canonical.PK, SK: 'CONVERSATION#other' }),
    ).toString('base64url');
    await expect(repository.list('couple-1', 'owner-1', forgedCursor)).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('atomically accepts a versioned delivery and maps storage conflicts', async () => {
    let rejectTransaction = false;
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof TransactWriteCommand) {
        if (rejectTransaction)
          throw Object.assign(new Error('stale'), { name: 'TransactionCanceledException' });
        return {};
      }
      if (command instanceof GetCommand)
        return command.input.Key?.['SK'] === 'MEMBER#owner-1'
          ? { Item: { status: 'ACTIVE', displayName: 'Owner' } }
          : {
              Item: {
                fingerprint: 'same',
                response: { deliveryId: 'delivery-1', cardId: card.cardId },
              },
            };
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbCardRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    const approved: Card = {
      ...card,
      status: 'QUEUED',
      version: 2,
      deliveryAt: '2025-05-10T12:01:00.000Z',
      updatedAt: '2025-05-10T12:01:00.000Z',
    };
    const result = await repository.approve(
      card,
      approved,
      'delivery-1',
      'idempotency-1',
      'hash',
      'Owner',
    );
    expect(result).toMatchObject({ deliveryId: 'delivery-1', status: 'QUEUED' });
    const transaction = send.mock.calls[0]?.[0] as TransactWriteCommand;
    expect(transaction.input.TransactItems?.map((item) => item.Put?.Item?.['SK'])).toEqual([
      canonical.SK,
      projection.SK,
      'DELIVERY#delivery-1',
      expect.stringMatching(/^DELIVERY_WORK#/),
      'SEND_REQUEST#owner-1#idempotency-1',
    ]);
    expect(await repository.senderDisplayName('couple-1', 'owner-1')).toBe('Owner');
    expect(await repository.findSendRequest('couple-1', 'owner-1', 'idempotency-1')).toMatchObject({
      fingerprint: 'same',
    });
    rejectTransaction = true;
    await expect(repository.delete(card, 1)).rejects.toBeInstanceOf(ConflictError);
  });
  it('removes storage keys from cards before updating distinct rows', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetCommand)
        return { Item: { ...card, ...canonical, entityType: 'CARD' } };
      if (command instanceof QueryCommand)
        return { Items: [{ ...card, ...projection, entityType: 'CARD' }] };
      if (command instanceof TransactWriteCommand) return {};
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbCardRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);

    const found = await repository.find('couple-1', 'owner-1', card.cardId);
    expect(found).toEqual(card);
    expect((await repository.list('couple-1', 'owner-1')).items).toEqual([card]);
    await repository.update({ ...found!, version: 2, body: 'Edited synthetic card.' }, 1);

    const transaction = send.mock.calls.find(
      ([command]) => command instanceof TransactWriteCommand,
    )?.[0] as TransactWriteCommand;
    const puts = transaction.input.TransactItems?.map((item) => item.Put?.Item);
    expect(puts).toEqual([
      expect.objectContaining({ ...canonical, version: 2 }),
      expect.objectContaining({ ...projection, version: 2 }),
    ]);
    expect(puts?.[0]?.['SK']).not.toBe(puts?.[1]?.['SK']);
  });
});
