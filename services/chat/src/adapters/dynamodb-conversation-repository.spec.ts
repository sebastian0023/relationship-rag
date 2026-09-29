import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DomainError } from '@relationship-rag/domain';
import { DynamoDbConversationRepository } from './dynamodb-conversation-repository.js';

describe('DynamoDbConversationRepository pagination', () => {
  it('rejects cursors from another query before reading user records', async () => {
    const send = vi.fn();
    const repository = new DynamoDbConversationRepository('test-table', {
      send,
    } as unknown as DynamoDBDocumentClient);
    const foreign = Buffer.from('CARD_CREATED#2025-05-10#card-1').toString('base64url');
    await expect(repository.list('couple-1', 'owner-1', foreign)).rejects.toBeInstanceOf(
      DomainError,
    );
    const otherConversation = Buffer.from('CONVERSATION#other#TURN#2025-05-10#turn-1').toString(
      'base64url',
    );
    await expect(
      repository.get('couple-1', 'owner-1', 'conversation-1', otherConversation),
    ).rejects.toBeInstanceOf(DomainError);
    expect(send).not.toHaveBeenCalled();
  });
});
