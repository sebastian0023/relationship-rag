/* global console */
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const expectedBudgets = { dev: 15, test: 20, prod: 50 };
for (const [stage, budget] of Object.entries(expectedBudgets)) {
  const config = JSON.parse(
    await readFile(new URL(`../config/stages/${stage}.json`, import.meta.url)),
  );
  if (config.stage !== stage) throw new Error(`${stage} config declares the wrong stage.`);
  if (config.monthlyBudgetUsd !== budget) throw new Error(`${stage} budget changed unexpectedly.`);
  if (config.apiRateLimit !== 10 || config.apiBurstLimit !== 20)
    throw new Error(`${stage} API throttling is not bounded as specified.`);
  if (config.aiReservedConcurrency !== 2)
    throw new Error(`${stage} AI concurrency is not bounded as specified.`);
  if (config.aiDeadlineMs <= 0 || config.aiDeadlineMs >= 28_000)
    throw new Error(`${stage} AI deadline must be positive and below the Lambda timeout.`);
  if (config.backupRetentionDays !== 35)
    throw new Error(`${stage} recovery retention must be 35 days.`);
}
console.log('Validated Phase 7 budget, capacity, deadline, and recovery guardrails.');
