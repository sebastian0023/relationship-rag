import type { MembershipRecord } from '@relationship-rag/contracts';

export interface MembershipRepository {
  findByUserId(coupleId: string, userId: string): Promise<MembershipRecord | undefined>;
}
