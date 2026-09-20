import { describe, expect, it, vi } from 'vitest';
import { DynamoDbMembershipRepository } from './dynamodb-membership-repository.js';

describe('DynamoDbMembershipRepository', () => {
  it('performs a strongly consistent read at the member access pattern', async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        userId: 'subject-1',
        coupleId: 'couple-1',
        role: 'OWNER',
        displayName: 'Alex',
        status: 'ACTIVE',
      },
    });
    const repository = new DynamoDbMembershipRepository('table-1', { send } as never);

    await expect(repository.findByUserId('couple-1', 'subject-1')).resolves.toMatchObject({
      role: 'OWNER',
      status: 'ACTIVE',
    });
    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      TableName: 'table-1',
      Key: { PK: 'COUPLE#couple-1', SK: 'MEMBER#subject-1' },
      ConsistentRead: true,
    });
  });

  it('treats malformed stored data as an unauthorized membership', async () => {
    const repository = new DynamoDbMembershipRepository('table-1', {
      send: vi.fn().mockResolvedValue({ Item: { userId: 'subject-1' } }),
    } as never);

    await expect(repository.findByUserId('couple-1', 'subject-1')).resolves.toBeUndefined();
  });
});
