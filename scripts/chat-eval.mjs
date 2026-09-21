/* global console */
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const datasetPath = new URL('../rag-evals/grounded-chat.v1.json', import.meta.url);
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (dataset.version !== 1 || !Array.isArray(dataset.cases) || dataset.cases.length === 0) {
  throw new Error('Grounded chat evaluation dataset must be version 1 with cases.');
}
const ids = new Set();
for (const item of dataset.cases) {
  if (typeof item.id !== 'string' || ids.has(item.id))
    throw new Error('Evaluation case IDs must be unique.');
  ids.add(item.id);
  if (
    typeof item.coupleId !== 'string' ||
    typeof item.question !== 'string' ||
    typeof item.abstention !== 'boolean'
  ) {
    throw new Error(`Evaluation case ${item.id} is missing required fields.`);
  }
  if (
    !Array.isArray(item.expectedMemoryIds) ||
    item.expectedMemoryIds.some((id) => !uuid.test(id))
  ) {
    throw new Error(`Evaluation case ${item.id} has invalid expected memory IDs.`);
  }
  if (item.abstention !== (item.expectedMemoryIds.length === 0) && item.id === 'unknown-dog') {
    throw new Error('Unknown-memory cases must expect abstention and no citations.');
  }
}
console.log(`Validated ${dataset.cases.length} grounded chat evaluation cases.`);
