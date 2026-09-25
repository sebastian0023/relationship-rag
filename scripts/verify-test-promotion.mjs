import { Buffer } from 'node:buffer';
import process from 'node:process';
const expectedSha = process.env.GITHUB_SHA;
const expectedRunId = process.env.TEST_RUN_ID;
if (!expectedSha || !/^\d+$/.test(expectedRunId ?? '')) {
  throw new Error('A commit SHA and numeric test validation run ID are required.');
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const run = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const workflowPath = String(run.path ?? '').split('@')[0];
if (
  String(run.id) !== expectedRunId ||
  run.head_sha !== expectedSha ||
  run.head_branch !== 'main' ||
  run.event !== 'workflow_dispatch' ||
  run.status !== 'completed' ||
  run.conclusion !== 'success' ||
  (workflowPath !== '.github/workflows/phase7-test-stage.yml' &&
    !workflowPath.endsWith('/.github/workflows/phase7-test-stage.yml'))
) {
  throw new Error('Test validation must have succeeded on this main-branch commit.');
}

process.stdout.write(`Validated test workflow run ${expectedRunId} for ${expectedSha}.\n`);
