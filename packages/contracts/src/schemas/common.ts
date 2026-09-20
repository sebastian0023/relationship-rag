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

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  correlationId: z.string().min(1).optional(),
});

export type Locale = z.infer<typeof localeSchema>;
export type MemberRole = z.infer<typeof memberRoleSchema>;
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
