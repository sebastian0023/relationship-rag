import { describe, expect, it } from 'vitest';
import { AuthorizationError } from '@relationship-rag/domain';
import { GetMyProfile } from './get-my-profile.js';
import type { MembershipRepository } from './ports.js';

const repository: MembershipRepository = {
  findByUserId: async (coupleId, userId) =>
    coupleId === 'couple-1' && userId === 'subject-1'
      ? {
          userId,
          coupleId,
          role: 'PARTNER',
          displayName: 'Sam',
          status: 'ACTIVE',
        }
      : undefined,
};

describe('GetMyProfile', () => {
  it('scopes the membership lookup to the configured couple', async () => {
    await expect(
      new GetMyProfile('couple-1', repository).execute({
        userId: 'subject-1',
        groups: ['PARTNER'],
      }),
    ).resolves.toMatchObject({ coupleId: 'couple-1', role: 'PARTNER' });
  });

  it('does not authorize a subject from another couple', async () => {
    await expect(
      new GetMyProfile('couple-2', repository).execute({
        userId: 'subject-1',
        groups: ['PARTNER'],
      }),
    ).rejects.toThrow(AuthorizationError);
  });
});
