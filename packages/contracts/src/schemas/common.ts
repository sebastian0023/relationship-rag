import { z } from 'zod';

export const localeSchema = z.enum(['en', 'es']);
export const memberRoleSchema = z.enum(['OWNER', 'PARTNER']);
export const idSchema = z.string().uuid();
export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const memberProfileSchema = z.object({
  userId: z.string().min(1),
  coupleId: z.string().min(1),
  role: memberRoleSchema,
  displayName: z.string().min(1).max(100),
});

export const membershipStatusSchema = z.enum(['RESERVED', 'ACTIVE']);

export const membershipRecordSchema = z.object({
  userId: z.string().min(1),
  coupleId: z.string().min(1),
  role: memberRoleSchema,
  displayName: z.string().min(1).max(100),
  status: membershipStatusSchema,
});

export const verifiedIdentitySchema = z.object({
  userId: z.string().min(1),
  groups: z.array(memberRoleSchema),
});

export const provisionMemberRequestSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(1).max(100),
  role: memberRoleSchema,
});

export const publicRuntimeConfigSchema = z.object({
  apiOrigin: z.url(),
  authority: z.url(),
  clientId: z.string().min(1),
  scope: z.literal('openid profile email relationship-rag/access'),
});

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  correlationId: z.string().min(1).optional(),
});

export type Locale = z.infer<typeof localeSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export type MembershipRecord = z.infer<typeof membershipRecordSchema>;
export type VerifiedIdentity = z.infer<typeof verifiedIdentitySchema>;
export type ProvisionMemberRequest = z.infer<typeof provisionMemberRequestSchema>;
export type PublicRuntimeConfig = z.infer<typeof publicRuntimeConfigSchema>;
