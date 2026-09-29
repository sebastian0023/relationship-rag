import { describe, expect, it, vi } from 'vitest';
import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DomainError } from '@relationship-rag/domain';
import { DynamoDbDeliveryRepository } from './dynamodb-delivery-repository.js';

describe('DynamoDbDeliveryRepository pagination', () => {
  it('uses the recipient partition and rejects a foreign or forged cursor', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof QueryCommand) return { Items: [] };
      throw new Error('Unexpected command.');
    });
    const repository = new DynamoDbDeliveryRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    expect(await repository.listInbox('recipient-1')).toEqual({ items: [] });
    const query = send.mock.calls[0]?.[0] as QueryCommand;
    expect(query.input.ExpressionAttributeValues?.[':pk']).toBe('USER#recipient-1');
    for (const key of [
      { PK: 'USER#other', SK: 'INBOX#2025-05-10#card-1' },
      { PK: 'USER#recipient-1', SK: 'INBOX_CARD#card-1' },
    ]) {
      const cursor = Buffer.from(JSON.stringify(key)).toString('base64url');
      await expect(repository.listInbox('recipient-1', cursor)).rejects.toBeInstanceOf(DomainError);
    }
    expect(send).toHaveBeenCalledTimes(1);
  });
});
