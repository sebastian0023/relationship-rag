import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { test } from 'node:test';

const sha = 'a'.repeat(40);
const validRun = {
  id: 123,
  head_sha: sha,
  head_branch: 'main',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/phase7-test-stage.yml',
};

const check = (run) =>
  spawnSync('node', ['scripts/verify-test-promotion.mjs'], {
    input: JSON.stringify(run),
    encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: sha, TEST_RUN_ID: '123' },
  });

test('allows a successful main-branch validation of this commit', () => {
  assert.equal(check(validRun).status, 0);
});

test('rejects a successful validation of a different commit', () => {
  assert.notEqual(check({ ...validRun, head_sha: 'b'.repeat(40) }).status, 0);
});

test('rejects a different workflow or an unsuccessful result', () => {
  assert.notEqual(check({ ...validRun, path: '.github/workflows/deploy-dev.yml' }).status, 0);
  assert.notEqual(check({ ...validRun, conclusion: 'failure' }).status, 0);
});
