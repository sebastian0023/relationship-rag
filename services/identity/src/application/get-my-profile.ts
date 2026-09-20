import type { MemberProfile, VerifiedIdentity } from '@relationship-rag/contracts';
import { profileForVerifiedIdentity } from '../domain/member.js';
import type { MembershipRepository } from './ports.js';

export class GetMyProfile {
  public constructor(
    private readonly coupleId: string,
    private readonly memberships: MembershipRepository,
  ) {}

  public async execute(identity: VerifiedIdentity): Promise<MemberProfile> {
    const membership = await this.memberships.findByUserId(this.coupleId, identity.userId);
    return profileForVerifiedIdentity(identity, membership);
  }
}
