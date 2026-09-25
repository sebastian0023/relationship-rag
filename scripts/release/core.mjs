import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  releaseManifestSchema,
  releaseAttestationSchema,
  releaseReportSchema,
} from '@relationship-rag/contracts';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function inventory(root, prefix = '') {
  const files = {};
  for (const entry of (await readdir(resolve(root, prefix), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('SYMLINK_IN_BUNDLE');
    if (entry.isDirectory()) Object.assign(files, await inventory(root, `${path}/`));
    else if (entry.isFile()) files[path] = digest(await readFile(resolve(root, path)));
    else throw new Error('UNSUPPORTED_BUNDLE_ENTRY');
  }
  return files;
}
export async function verifyBundle(root, expectedDigest, expectedCommit) {
  const bytes = await readFile(resolve(root, 'manifest.json'));
  if (digest(bytes) !== expectedDigest) throw new Error('BUNDLE_DIGEST_MISMATCH');
  const manifest = releaseManifestSchema.parse(JSON.parse(bytes));
  if (manifest.commit !== expectedCommit) throw new Error('COMMIT_MISMATCH');
  const files = await inventory(resolve(root, 'payload'));
  if (JSON.stringify(files) !== JSON.stringify(manifest.files))
    throw new Error('BUNDLE_CONTENT_MISMATCH');
  return manifest;
}
export function verifyPromotion(attestation, report, commit, bundleDigest, now = Date.now()) {
  const reviewed = releaseAttestationSchema.parse(attestation);
  const results = releaseReportSchema.parse(report);
  for (const input of [reviewed, results]) {
    if (input.commit !== commit || input.bundleDigest !== bundleDigest)
      throw new Error('EVIDENCE_MISMATCH');
  }
  if (
    Date.parse(reviewed.reviewedAt) > now ||
    now - Date.parse(reviewed.reviewedAt) > 7 * 86400_000
  )
    throw new Error('EVIDENCE_EXPIRED');
  const required = [
    'identity-isolation',
    'memories-media',
    'chat-grounding',
    'cards-delivery',
    'accessibility',
    'retrieval',
    'ai-budgets',
  ];
  if (
    new Set(results.cases.map((item) => item.id)).size !== results.cases.length ||
    required.some((id) => !results.cases.some((item) => item.id === id && item.passed)) ||
    results.cases.some((item) => !item.passed) ||
    results.recallAt5 < 0.9 ||
    results.abstentionRate < 0.95 ||
    results.citationCorrectness !== 1 ||
    results.leakageCount !== 0 ||
    results.forbiddenFactCount !== 0 ||
    ['chat', 'cards'].some((service) =>
      ['ModelInputTokens', 'ModelOutputTokens', 'ModelLatency'].some(
        (metric) =>
          results.aiUsage.filter(
            (item) => item.service === service && item.metric === metric && item.sum > 0,
          ).length !== 1,
      ),
    ) ||
    results.aiUsage.some(
      (item) =>
        (item.metric === 'ModelLatency' && item.maximum > 24000) ||
        (item.metric === 'ModelOutputTokens' &&
          item.maximum > (item.service === 'chat' ? 1024 : 1200)),
    )
  )
    throw new Error('RELEASE_GATE_FAILED');
  return results;
}
export function verifyProtection(environment) {
  const review = environment.protection_rules?.find((rule) => rule.type === 'required_reviewers');
  if (
    !review?.reviewers?.length ||
    environment.can_admins_bypass !== false ||
    environment.deployment_branch_policy?.protected_branches !== true
  )
    throw new Error('PRODUCTION_PROTECTION_REQUIRED');
}
export function publicationPlan(paths) {
  if (!paths.includes('index.html')) throw new Error('MISSING_ENTRYPOINT');
  return paths
    .filter((path) => path !== 'index.html' && path !== 'assets/runtime-config.json')
    .map((path) => ({
      path,
      cacheControl: /-[A-Z0-9]{8,}\.(?:js|css|woff2?|png|webp|svg)$/i.test(path)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    }))
    .concat([
      { path: 'assets/runtime-config.json', cacheControl: 'no-store' },
      { path: 'index.html', cacheControl: 'no-store' },
    ]);
}
