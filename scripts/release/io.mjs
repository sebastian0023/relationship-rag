/* global process */
import { execFileSync } from 'node:child_process';
export const required = (key) => {
  const value = process.env[key];
  if (!value?.trim()) throw new Error('MISSING_RELEASE_INPUT');
  return value;
};
// Never forward AWS/HTTP raw exceptions or output to CI logs.
export function command(executable, args) {
  try {
    return execFileSync(executable, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    throw new Error('RELEASE_COMMAND_FAILED');
  }
}
export const aws = (args) => JSON.parse(command('aws', [...args, '--output', 'json']));
export function outputs(stage, stack) {
  if (!['dev', 'test', 'prod'].includes(stage)) throw new Error('INVALID_STAGE');
  const result = aws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    `relationship-rag-${stage}-${stack}`,
  ]);
  return Object.fromEntries(
    result.Stacks[0].Outputs.map((entry) => [entry.OutputKey, entry.OutputValue]),
  );
}
export function verifyAccount() {
  if (aws(['sts', 'get-caller-identity']).Account !== required('EXPECTED_AWS_ACCOUNT_ID'))
    throw new Error('WRONG_AWS_ACCOUNT');
  required('AWS_REGION');
}
