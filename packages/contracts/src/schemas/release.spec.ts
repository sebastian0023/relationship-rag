import { describe, expect, it } from 'vitest';
import {
  releaseAcceptanceSchema,
  releaseManifestSchema,
  releaseEvaluationDatasetSchema,
} from './release.js';
import dataset from '../../../../rag-evals/production-release.v1.json' with { type: 'json' };

const commit = 'a'.repeat(40),
  hash = 'b'.repeat(64);
describe('release contracts', () => {
  it('rejects traversal, empty manifests, unknown fields and malformed identities', () => {
    const manifest = {
      version: 1,
      commit,
      createdAt: '2026-09-22T00:00:00Z',
      files: { 'lambda/node_modules/@img/sharp/package.json': hash },
      datasetVersions: { 'release.v1.json': 1 },
      configurationDigest: hash,
    };
    expect(releaseManifestSchema.safeParse(manifest).success).toBe(true);
    for (const path of ['../secret', '/absolute', 'a/../secret', 'a//b', './a'])
      expect(
        releaseManifestSchema.safeParse({ ...manifest, files: { [path]: hash } }).success,
      ).toBe(false);
    expect(releaseManifestSchema.safeParse({ ...manifest, files: {} }).success).toBe(false);
    expect(releaseManifestSchema.safeParse({ ...manifest, commit: 'main' }).success).toBe(false);
    expect(releaseManifestSchema.safeParse({ ...manifest, token: 'secret' }).success).toBe(false);
  });
  it('requires both onboarding outcomes and a full day of observation', () => {
    const accepted = {
      version: 1,
      commit,
      bundleDigest: hash,
      deployedAt: '2026-09-21T00:00:00Z',
      observedUntil: '2026-09-22T00:00:00Z',
      ownerOnboarded: true,
      partnerOnboarded: true,
      memoriesReviewedAndIndexed: true,
      groundingReviewed: true,
      alertsConfirmed: true,
      noUnresolvedFailures: true,
    };
    expect(releaseAcceptanceSchema.safeParse(accepted).success).toBe(true);
    expect(
      releaseAcceptanceSchema.safeParse({ ...accepted, observedUntil: '2026-09-21T23:59:59Z' })
        .success,
    ).toBe(false);
    expect(
      releaseAcceptanceSchema.safeParse({ ...accepted, partnerOnboarded: false }).success,
    ).toBe(false);
  });
  it('requires known and unknown cases with unique keys and resolvable expectations', () => {
    expect(releaseEvaluationDatasetSchema.safeParse(dataset).success).toBe(true);
    expect(
      releaseEvaluationDatasetSchema.safeParse({
        ...dataset,
        cases: dataset.cases.filter((item) => !item.abstention),
      }).success,
    ).toBe(false);
    expect(
      releaseEvaluationDatasetSchema.safeParse({
        ...dataset,
        memories: [...dataset.memories, dataset.memories[0]],
      }).success,
    ).toBe(false);
    expect(
      releaseEvaluationDatasetSchema.safeParse({
        ...dataset,
        cases: [...dataset.cases, { ...dataset.cases[0], id: 'bad', expectedKeys: ['missing'] }],
      }).success,
    ).toBe(false);
  });
});
