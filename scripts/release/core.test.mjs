import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  digest,
  inventory,
  verifyBundle,
  verifyPromotion,
  verifyProtection,
  publicationPlan,
} from './core.mjs';
import { operationalChecks } from '@relationship-rag/contracts';
const commit = 'a'.repeat(40),
  bundleDigest = 'b'.repeat(64);
const attestation = () => ({
  version: 1,
  commit,
  bundleDigest,
  reviewer: 'operator',
  reviewedAt: new Date().toISOString(),
  checks: Object.fromEntries(operationalChecks.map((key) => [key, true])),
});
const report = () => ({
  version: 1,
  commit,
  bundleDigest,
  cases: [
    'identity-isolation',
    'memories-media',
    'chat-grounding',
    'cards-delivery',
    'accessibility',
    'retrieval',
    'ai-budgets',
  ].map((id) => ({ id, passed: true, durationMs: 1 })),
  aiUsage: ['chat', 'cards'].flatMap((service) =>
    ['ModelInputTokens', 'ModelOutputTokens', 'ModelLatency'].map((metric) => ({
      service,
      metric,
      maximum: 1,
      sum: 1,
    })),
  ),
  recallAt5: 1,
  abstentionRate: 1,
  citationCorrectness: 1,
  leakageCount: 0,
  forbiddenFactCount: 0,
});
describe('release eligibility', () => {
  it('accepts complete evidence and rejects skipped, stale, mismatched or failing gates', () => {
    expect(verifyPromotion(attestation(), report(), commit, bundleDigest)).toBeTruthy();
    for (const changed of [
      { cases: [] },
      { recallAt5: 0.89 },
      { abstentionRate: 0.94 },
      { citationCorrectness: 0.99 },
      { leakageCount: 1 },
      { forbiddenFactCount: 1 },
      { commit: 'c'.repeat(40) },
    ])
      expect(() =>
        verifyPromotion(attestation(), { ...report(), ...changed }, commit, bundleDigest),
      ).toThrow();
    expect(() =>
      verifyPromotion({ ...attestation(), checks: {} }, report(), commit, bundleDigest),
    ).toThrow();
    expect(() =>
      verifyPromotion(
        { ...attestation(), reviewedAt: '2000-01-01T00:00:00Z' },
        report(),
        commit,
        bundleDigest,
      ),
    ).toThrow();
    expect(() =>
      verifyPromotion({ ...attestation(), secret: 'private' }, report(), commit, bundleDigest),
    ).toThrow();
  });
  it('requires actual reviewers and disabled bypass', () => {
    expect(() => verifyProtection({})).toThrow();
    expect(() =>
      verifyProtection({
        protection_rules: [{ type: 'required_reviewers', reviewers: [{}] }],
        can_admins_bypass: true,
      }),
    ).toThrow();
    expect(() =>
      verifyProtection({
        protection_rules: [{ type: 'required_reviewers', reviewers: [{}] }],
        can_admins_bypass: false,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      }),
    ).toThrow();
    expect(() =>
      verifyProtection({
        protection_rules: [{ type: 'required_reviewers', reviewers: [{}] }],
        can_admins_bypass: false,
        deployment_branch_policy: { protected_branches: true },
      }),
    ).not.toThrow();
  });
  it('detects corrupted, additional and substituted assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'release-test-'));
    try {
      await mkdir(join(root, 'payload'));
      await writeFile(join(root, 'payload', 'app.js'), 'verified');
      const manifest = {
        version: 1,
        commit,
        createdAt: new Date().toISOString(),
        files: await inventory(join(root, 'payload')),
        datasetVersions: { test: 1 },
        configurationDigest: bundleDigest,
      };
      const bytes = JSON.stringify(manifest);
      await writeFile(join(root, 'manifest.json'), bytes);
      expect(await verifyBundle(root, digest(bytes), commit)).toEqual(manifest);
      await writeFile(join(root, 'payload', 'app.js'), 'modified');
      await expect(verifyBundle(root, digest(bytes), commit)).rejects.toThrow(
        'BUNDLE_CONTENT_MISMATCH',
      );
      await expect(verifyBundle(root, bundleDigest, commit)).rejects.toThrow(
        'BUNDLE_DIGEST_MISMATCH',
      );
      await expect(verifyBundle(root, digest(bytes), 'c'.repeat(40))).rejects.toThrow(
        'COMMIT_MISMATCH',
      );
      await symlink('/tmp', join(root, 'payload', 'link'));
      await expect(inventory(join(root, 'payload'))).rejects.toThrow('SYMLINK');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('publishes config then HTML after assets; only fingerprints are immutable', () => {
    const plan = publicationPlan([
      'index.html',
      'main-ABC12345.js',
      'favicon.ico',
      'assets/runtime-config.json',
    ]);
    expect(plan.map((item) => item.path)).toEqual([
      'main-ABC12345.js',
      'favicon.ico',
      'assets/runtime-config.json',
      'index.html',
    ]);
    expect(plan.map((item) => item.cacheControl)).toEqual([
      'public, max-age=31536000, immutable',
      'no-store',
      'no-store',
      'no-store',
    ]);
    expect(() => publicationPlan([])).toThrow();
  });
});
