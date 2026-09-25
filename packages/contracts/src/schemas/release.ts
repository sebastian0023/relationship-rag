import { z } from 'zod';
import { createMemoryRequestSchema } from './memory.js';
import { memoryRetrievalFiltersSchema } from './chat.js';

export const releaseCommitSchema = z.string().regex(/^[0-9a-f]{40}$/);
export const releaseDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const safePath = z
  .string()
  .regex(/^[a-zA-Z0-9_@+./-]+$/)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      value.split('/').every((part) => part !== '..' && part !== '.' && part !== ''),
  );
export const releaseManifestSchema = z.strictObject({
  version: z.literal(1),
  commit: releaseCommitSchema,
  createdAt: z.iso.datetime(),
  files: z.record(safePath, releaseDigestSchema).refine((files) => Object.keys(files).length > 0),
  datasetVersions: z.record(z.string().regex(/^[a-z0-9.-]+$/), z.number().int().positive()),
  configurationDigest: releaseDigestSchema,
});
export const operationalChecks = [
  'alarmNotification',
  'restoreDrill',
  'deliveryRecovery',
  'rollbackRehearsal',
  'privateTelemetryReview',
  'generatedClaimsReview',
  'billingTagsActive',
] as const;
export const releaseAttestationSchema = z.strictObject({
  version: z.literal(1),
  commit: releaseCommitSchema,
  bundleDigest: releaseDigestSchema,
  reviewedAt: z.iso.datetime(),
  reviewer: z.string().regex(/^[a-zA-Z0-9-]{1,39}$/),
  checks: z.strictObject(
    Object.fromEntries(operationalChecks.map((key) => [key, z.literal(true)])) as Record<
      (typeof operationalChecks)[number],
      z.ZodLiteral<true>
    >,
  ),
});
export const releaseCaseResultSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  passed: z.boolean(),
  durationMs: z.number().nonnegative(),
});
export const releaseReportSchema = z.strictObject({
  version: z.literal(1),
  commit: releaseCommitSchema,
  bundleDigest: releaseDigestSchema,
  cases: z.array(releaseCaseResultSchema).min(1),
  aiUsage: z.array(
    z.strictObject({
      service: z.enum(['chat', 'cards']),
      metric: z.enum(['ModelInputTokens', 'ModelOutputTokens', 'ModelLatency']),
      maximum: z.number().nonnegative(),
      sum: z.number().nonnegative(),
    }),
  ),
  recallAt5: z.number().min(0).max(1),
  abstentionRate: z.number().min(0).max(1),
  citationCorrectness: z.number().min(0).max(1),
  leakageCount: z.number().int().nonnegative(),
  forbiddenFactCount: z.number().int().nonnegative(),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export const releaseAcceptanceSchema = z
  .strictObject({
    version: z.literal(1),
    commit: releaseCommitSchema,
    bundleDigest: releaseDigestSchema,
    deployedAt: z.iso.datetime(),
    observedUntil: z.iso.datetime(),
    ownerOnboarded: z.literal(true),
    partnerOnboarded: z.literal(true),
    memoriesReviewedAndIndexed: z.literal(true),
    groundingReviewed: z.literal(true),
    alertsConfirmed: z.literal(true),
    noUnresolvedFailures: z.literal(true),
  })
  .refine((input) => Date.parse(input.observedUntil) - Date.parse(input.deployedAt) >= 86400_000);

export const releaseEvaluationDatasetSchema = z
  .strictObject({
    version: z.literal(1),
    minimumRecall: z.literal(0.9),
    minimumAbstentionRate: z.literal(0.95),
    memories: z.array(createMemoryRequestSchema.extend({ key: z.string().min(1) })).min(1),
    cases: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z0-9-]+$/),
          question: z.string().min(1),
          filters: memoryRetrievalFiltersSchema.optional(),
          expectedKeys: z.array(z.string()),
          requiredFacts: z.array(z.string()),
          forbiddenFacts: z.array(z.string()),
          abstention: z.boolean(),
        }),
      )
      .min(1),
  })
  .superRefine((data, ctx) => {
    const keys = new Set(data.memories.map((item) => item.key));
    if (
      keys.size !== data.memories.length ||
      new Set(data.cases.map((item) => item.id)).size !== data.cases.length ||
      data.cases.some(
        (item) =>
          item.expectedKeys.some((key) => !keys.has(key)) ||
          item.abstention !== (item.expectedKeys.length === 0),
      ) ||
      !data.cases.some((item) => item.abstention) ||
      !data.cases.some((item) => !item.abstention)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid release evaluation coverage.' });
  });
