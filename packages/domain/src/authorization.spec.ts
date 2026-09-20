import { describe, expect, it } from 'vitest';
import { belongsToCouple, canManageInvitations, type Actor } from './authorization.js';
import { AuthorizationError, ResourceNotFoundError } from './errors.js';

const owner: Actor = { userId: 'owner-1', coupleId: 'couple-1', role: 'OWNER' };

describe('authorization primitives', () => {
  it('permits access only within the actor couple', () => {
    expect(belongsToCouple(owner, 'couple-1')).toBe(true);
    expect(belongsToCouple(owner, 'couple-2')).toBe(false);
  });

  it('reserves invitation management for the owner', () => {
    expect(canManageInvitations(owner)).toBe(true);
    expect(canManageInvitations({ ...owner, role: 'PARTNER' })).toBe(false);
  });
});

describe('safe domain errors', () => {
  it('uses generic messages for authorization and missing resources', () => {
    expect(new AuthorizationError()).toMatchObject({ code: 'FORBIDDEN' });
    expect(new ResourceNotFoundError()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
