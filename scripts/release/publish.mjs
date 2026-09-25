import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publicRuntimeConfigSchema } from '@relationship-rag/contracts';
import { inventory, publicationPlan } from './core.mjs';
import { command, aws, outputs, required } from './io.mjs';
export async function publishFrontend(stage, web) {
  const edge = outputs(stage, 'edge'),
    auth = outputs(stage, 'auth'),
    api = outputs(stage, 'api');
  const config = publicRuntimeConfigSchema.parse({
    apiOrigin: api.ApiEndpoint,
    authority: auth.UserPoolIssuer,
    clientId: auth.UserPoolClientId,
    scope: 'openid profile email relationship-rag/access',
  });
  // Stage config is materialized outside the sealed bundle.
  const configPath = resolve(required('RUNNER_TEMP'), 'runtime-config.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const files = await inventory(web);
  for (const item of publicationPlan(Object.keys(files))) {
    const source =
      item.path === 'assets/runtime-config.json' ? configPath : resolve(web, item.path);
    command('aws', [
      's3',
      'cp',
      source,
      `s3://${edge.FrontendBucketName}/${item.path}`,
      '--cache-control',
      item.cacheControl,
      '--only-show-errors',
    ]);
  }
  const invalidation = aws([
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    edge.DistributionId,
    '--paths',
    '/*',
  ]);
  command('aws', [
    'cloudfront',
    'wait',
    'invalidation-completed',
    '--distribution-id',
    edge.DistributionId,
    '--id',
    invalidation.Invalidation.Id,
  ]);
}
