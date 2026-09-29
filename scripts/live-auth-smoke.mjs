/* global console, process, fetch */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

const aws = (args) =>
  execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'text'], {
    encoding: 'utf8',
  }).trim();
const expectedAccount = process.env['AWS_ACCOUNT_ID'];
if (
  !/^\d{12}$/.test(expectedAccount ?? '') ||
  aws(['sts', 'get-caller-identity', '--query', 'Account']) !== expectedAccount
)
  throw new Error('AWS account preflight failed.');
const origin = aws([
  'cloudformation',
  'describe-stacks',
  '--stack-name',
  'relationship-rag-test-api',
  '--query',
  "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue | [0]",
]);
if (!origin.startsWith('https://')) throw new Error('Test API endpoint is missing.');
const stack = JSON.parse(
  execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'relationship-rag-test-api',
      '--region',
      'us-east-1',
      '--output',
      'json',
    ],
    { encoding: 'utf8' },
  ),
).Stacks[0];
if (!stack.Tags?.some((tag) => tag.Key === 'Environment' && tag.Value === 'test'))
  throw new Error('API stack is not tagged test.');
const source = await readFile(
  new URL('../apps/infrastructure/lib/stacks.ts', import.meta.url),
  'utf8',
);
const routes = [
  ...new Set(
    [...source.matchAll(/'(GET|POST|PATCH|DELETE) (\/[^']+)'/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    ),
  ),
];
if (routes.length !== 25)
  throw new Error(`Expected 25 protected API routes, found ${routes.length}.`);
for (const route of routes) {
  const [method, rawPath] = route.split(' ');
  const path = rawPath.replaceAll(/\{[^}]+\}/g, '11111111-1111-4111-8111-111111111111');
  const anonymous = await fetch(`${origin}${path}`, { method });
  if (anonymous.status !== 401) throw new Error(`${route}: anonymous status ${anonymous.status}.`);
  const malformed = await fetch(`${origin}${path}`, {
    method,
    headers: { authorization: 'Bearer invalid' },
  });
  if (malformed.status !== 401)
    throw new Error(`${route}: malformed-token status ${malformed.status}.`);
  await delay(200);
}
console.log(
  `Confirmed anonymous and malformed tokens are rejected on ${routes.length} test-stage routes.`,
);
