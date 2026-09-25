/* global process, console */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { releaseAcceptanceSchema } from '@relationship-rag/contracts';
import { command, required } from './io.mjs';
try {
  const accepted = releaseAcceptanceSchema.parse(
    JSON.parse(await readFile(required('RELEASE_ACCEPTANCE'), 'utf8')),
  );
  if (Date.parse(accepted.observedUntil) > Date.now()) throw new Error('OBSERVATION_IN_FUTURE');
  const deployment = JSON.parse(await readFile(required('RELEASE_DEPLOYMENT_RECORD'), 'utf8'));
  if (
    deployment.commit !== accepted.commit ||
    deployment.bundleDigest !== accepted.bundleDigest ||
    deployment.deployedAt !== accepted.deployedAt
  )
    throw new Error('DEPLOYMENT_MISMATCH');
  command('git', ['merge-base', '--is-ancestor', accepted.commit, 'origin/main']);
  if (!process.argv.includes('--apply'))
    console.log(
      'Acceptance validated. Review the deployment record before explicitly applying the v1.0.0 tag.',
    );
  else {
    const notes = resolve(required('RUNNER_TEMP'), 'release-notes.md');
    await writeFile(
      notes,
      `Verified private timeline, grounded chat, card studio and explicitly confirmed delivery.\n\nCommit: ${accepted.commit}\nBundle SHA-256: ${accepted.bundleDigest}\n\nSynthetic acceptance and operational review completed. Both invited users onboarded; initial memories reviewed and indexed; 24-hour observation accepted.\n\nRollback: follow docs/operations/phase-8-release.md using the retained verified candidate.\n`,
    );
    command('gh', [
      'release',
      'create',
      'v1.0.0',
      '--repo',
      required('GITHUB_REPOSITORY'),
      '--target',
      accepted.commit,
      '--title',
      'Relationship RAG v1.0.0',
      '--notes-file',
      notes,
    ]);
    console.log('Published v1.0.0 for the accepted commit.');
  }
} catch {
  console.error(
    'Release finalization blocked: acceptance, deployment identity or publication failed.',
  );
  process.exitCode = 1;
}
