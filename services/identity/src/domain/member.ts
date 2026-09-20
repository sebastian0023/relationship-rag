import type {
  MemberProfile,
  MembershipRecord,
  VerifiedIdentity,
} from '@relationship-rag/contracts';
import { AuthorizationError } from '@relationship-rag/domain';

export const profileForVerifiedIdentity = (
  identity: VerifiedIdentity,
  membership: MembershipRecord | undefined,
): MemberProfile => {
  if (
    membership === undefined ||
    membership.status !== 'ACTIVE' ||
    membership.userId !== identity.userId
  ) {
    throw new AuthorizationError();
  }

  if (identity.groups.length !== 1 || identity.groups[0] !== membership.role) {
    throw new AuthorizationError();
  }

  return {
    userId: membership.userId,
    coupleId: membership.coupleId,
    role: membership.role,
    displayName: membership.displayName,
  };
};
