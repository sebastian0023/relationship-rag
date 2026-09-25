/* global process, console, fetch, AbortSignal */
import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  releaseCommitSchema,
  releaseManifestSchema,
  publicRuntimeConfigSchema,
} from '@relationship-rag/contracts';
import { digest, inventory, verifyBundle, verifyPromotion, verifyProtection } from './core.mjs';
import { command, outputs, required, verifyAccount } from './io.mjs';

import { publishFrontend } from './publish.mjs';

const root = resolve(process.env.RELEASE_DIR ?? 'release-bundle');
const mode = process.argv[2];
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const expectedCommit = () => releaseCommitSchema.parse(required('RELEASE_COMMIT'));
const check = () => verifyBundle(root, required('RELEASE_DIGEST'), expectedCommit());
async function packageRelease() {
  const commit = expectedCommit();
  if (command('git', ['rev-parse', 'HEAD']).trim() !== commit) throw new Error('CHECKOUT_MISMATCH');
  command('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
  if (command('git', ['status', '--porcelain', '--untracked-files=normal']).trim())
    throw new Error('DIRTY_CANDIDATE');
  const payload = resolve(root, 'payload');
  await mkdir(payload, { recursive: false });
  await cp('apps/web/dist/relationship-rag-web/browser', resolve(payload, 'web'), {
    recursive: true,
  });
  await cp('config/stages', resolve(payload, 'config'), { recursive: true });
  await cp('rag-evals', resolve(payload, 'rag-evals'), { recursive: true });
  const assembly = required('RELEASE_ASSEMBLY');
  let count = 0;
  for (const filename of await readdir(assembly)) {
    if (!filename.endsWith('.template.json')) continue;
    const template = await json(resolve(assembly, filename));
    for (const resource of Object.values(template.Resources)) {
      if (resource.Type !== 'AWS::Lambda::Function') continue;
      const id = resource.Metadata?.['aws:cdk:path']?.split('/').at(-2);
      const path = resource.Metadata?.['aws:asset:path'];
      if (!id?.endsWith('Function') || !path) continue;
      await cp(resolve(assembly, path), resolve(payload, 'lambda', id), {
        recursive: true,
        dereference: true,
      });
      count++;
    }
  }
  if (count !== 10) throw new Error('INCOMPLETE_LAMBDA_BUNDLE');
  const versions = {};
  for (const file of await readdir('rag-evals'))
    if (file.endsWith('.json')) versions[file] = (await json(`rag-evals/${file}`)).version;
  const manifest = releaseManifestSchema.parse({
    version: 1,
    commit,
    createdAt: new Date().toISOString(),
    files: await inventory(payload),
    datasetVersions: versions,
    configurationDigest: digest(JSON.stringify(await inventory(resolve(payload, 'config')))),
  });
  const bytes = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(resolve(root, 'manifest.json'), bytes);
  console.log(digest(bytes));
}
async function publish() {
  await check();
  verifyAccount();
  await publishFrontend(required('RELEASE_STAGE'), resolve(root, 'payload/web'));
}
async function smoke() {
  verifyAccount();
  const stage = required('RELEASE_STAGE');
  const edge = outputs(stage, 'edge');
  const base = `https://${edge.DistributionDomainName}`;
  const index = await fetch(base, { signal: AbortSignal.timeout(30000) });
  if (
    !index.ok ||
    !index.headers.get('strict-transport-security') ||
    !index.headers.get('cache-control')?.includes('no-store')
  )
    throw new Error('FRONTEND_SMOKE_FAILED');
  const response = await fetch(`${base}/assets/runtime-config.json`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.headers.get('cache-control')?.includes('no-store'))
    throw new Error('CONFIG_SMOKE_FAILED');
  const config = publicRuntimeConfigSchema.parse(await response.json());
  const api = outputs(stage, 'api'),
    auth = outputs(stage, 'auth');
  if (
    config.apiOrigin !== api.ApiEndpoint ||
    config.authority !== auth.UserPoolIssuer ||
    config.clientId !== auth.UserPoolClientId
  )
    throw new Error('CONFIG_STAGE_MISMATCH');
  for (const token of [undefined, 'invalid']) {
    const result = await fetch(`${config.apiOrigin}/me`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(30000),
    });
    if (result.status !== 401) throw new Error('UNAUTHENTICATED_API_ACCEPTED');
  }
}
try {
  if (mode === 'package') await packageRelease();
  else if (mode === 'verify') await check();
  else if (mode === 'protection') {
    const environment = JSON.parse(
      command('gh', ['api', `repos/${required('GITHUB_REPOSITORY')}/environments/prod`]),
    );
    verifyProtection(environment);
  } else if (mode === 'evidence') {
    await check();
    verifyPromotion(
      await json(required('RELEASE_ATTESTATION')),
      await json(required('RELEASE_REPORT')),
      expectedCommit(),
      required('RELEASE_DIGEST'),
    );
  } else if (mode === 'publish') await publish();
  else if (mode === 'smoke') await smoke();
  else throw new Error('UNKNOWN_RELEASE_COMMAND');
} catch {
  console.error(
    'Release gate failed. Check protected inputs and the documented prerequisites; raw diagnostics are suppressed.',
  );
  process.exitCode = 1;
}
