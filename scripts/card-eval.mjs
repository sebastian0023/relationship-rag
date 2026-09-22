/* global console */
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
const dataset = JSON.parse(
  await readFile(new URL('../rag-evals/card-grounding.v1.json', import.meta.url), 'utf8'),
);
if (dataset.version !== 1 || !Array.isArray(dataset.cases) || dataset.cases.length === 0)
  throw new Error('Card evaluation dataset must be version 1 with cases.');
for (const item of dataset.cases) {
  const selected = new Set(item.selectedMemoryIds);
  if (
    !item.id ||
    !item.draft?.title ||
    !item.draft?.body ||
    !Array.isArray(item.draft.citedMemoryIds)
  )
    throw new Error(`Invalid card case ${item.id ?? 'unknown'}.`);
  if (item.draft.citedMemoryIds.some((id) => !selected.has(id)))
    throw new Error(`Case ${item.id} cites an unselected memory.`);
  if (selected.size > 0 && item.draft.citedMemoryIds.length === 0)
    throw new Error(`Case ${item.id} lacks grounding citations.`);
  if (selected.size === 0 && item.draft.citedMemoryIds.length > 0)
    throw new Error(`Generic case ${item.id} must not cite memories.`);
  if (!Array.isArray(item.unsupportedFacts) || item.unsupportedFacts.length > 0)
    throw new Error(`Case ${item.id} contains unsupported facts.`);
}
console.log(
  `Validated ${dataset.cases.length} executable card-grounding cases with zero unsupported facts.`,
);
