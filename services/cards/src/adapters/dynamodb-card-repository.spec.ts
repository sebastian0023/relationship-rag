import { describe, expect, it, vi } from 'vitest';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { Card } from '../domain/card.js';
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
