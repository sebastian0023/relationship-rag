/* global process, console */
import { resolve } from 'node:path';
import { publishFrontend } from './publish.mjs';
try {
  const stage = process.argv[2];
  if (!['dev', 'test'].includes(stage)) throw new Error('USE_VERIFIED_PRODUCTION_RELEASE');
  await publishFrontend(stage, resolve('apps/web/dist/relationship-rag-web/browser'));
} catch {
  console.error('Frontend publication failed; inspect protected deployment diagnostics.');
  process.exitCode = 1;
}
