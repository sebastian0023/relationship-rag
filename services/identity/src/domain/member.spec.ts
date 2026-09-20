import { describe, expect, it } from 'vitest';
import { AuthorizationError } from '@relationship-rag/domain';
import { profileForVerifiedIdentity } from './member.js';

const membership = {
  userId: 'subject-1',
  coupleId: 'couple-1',
  role: 'OWNER' as const,
  displayName: 'Alex',
  status: 'ACTIVE' as const,
};

describe('profileForVerifiedIdentity', () => {
  it('returns a profile only for an active matching role', () => {
    expect(
      profileForVerifiedIdentity({ userId: 'subject-1', groups: ['OWNER'] }, membership),
    ).toEqual({
      userId: 'subject-1',
      coupleId: 'couple-1',
      role: 'OWNER',
      displayName: 'Alex',
    });
  });

  it.each([
    [{ userId: 'subject-2', groups: ['OWNER'] }, membership],
    [{ userId: 'subject-1', groups: ['PARTNER'] }, membership],
    [{ userId: 'subject-1', groups: ['OWNER', 'PARTNER'] }, membership],
    [
      { userId: 'subject-1', groups: ['OWNER'] },
      { ...membership, status: 'RESERVED' as const },
    ],
  ])('rejects an inactive, mismatched, or ambiguous identity', (identity, record) => {
    expect(() => profileForVerifiedIdentity(identity, record)).toThrow(AuthorizationError);
  });
});
