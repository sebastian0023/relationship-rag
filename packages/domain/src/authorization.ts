export type Role = 'OWNER' | 'PARTNER';

export interface Actor {
  readonly userId: string;
  readonly coupleId: string;
  readonly role: Role;
}

export const belongsToCouple = (actor: Actor, resourceCoupleId: string): boolean =>
  actor.coupleId === resourceCoupleId;

export const canManageInvitations = (actor: Actor): boolean => actor.role === 'OWNER';
