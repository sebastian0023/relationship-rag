import { createHash } from 'node:crypto';
import type { Memory } from '../domain/memory.js';

export const DOCUMENT_FORMAT_VERSION = 1;
const normalizeFilter = (value: string): string => value.trim().toLocaleLowerCase('en-US');
export const normalizedFilterHash = (value: string): string =>
  createHash('sha256').update(normalizeFilter(value)).digest('base64url').slice(0, 22);

export interface NormalizedMemoryDocument {
  readonly key: string;
  readonly metadataKey: string;
  readonly body: string;
  readonly metadata: string;
  readonly fingerprint: string;
}

export const normalizeMemoryDocument = (memory: Memory): NormalizedMemoryDocument => {
  const body = [
    `# ${memory.title}`,
    '',
    `Date: ${memory.occurredOn}`,
    `Language: ${memory.locale}`,
    ...(memory.location === undefined ? [] : [`Location: ${memory.location}`]),
    ...(memory.category === undefined ? [] : [`Category: ${memory.category}`]),
    ...(memory.tags.length === 0 ? [] : [`Tags: ${memory.tags.join(', ')}`]),
    '',
    memory.body,
    '',
  ].join('\n');
  const fingerprint = createHash('sha256').update(body, 'utf8').digest('hex');
  const metadataAttributes: Record<string, unknown> = {
    coupleId: memory.coupleId,
    memoryId: memory.memoryId,
    fingerprint,
    formatVersion: DOCUMENT_FORMAT_VERSION,
    occurredOn: Date.parse(`${memory.occurredOn}T00:00:00.000Z`) / 1000,
  };
  if (memory.category !== undefined)
    metadataAttributes['category'] = normalizedFilterHash(memory.category);
  if (memory.tags.length > 0) metadataAttributes['tags'] = memory.tags.map(normalizedFilterHash);
  const metadata = JSON.stringify({ metadataAttributes });
  if (Buffer.byteLength(metadata, 'utf8') > 1024)
    throw new Error('Memory metadata exceeds the 1 KiB knowledge base limit.');
  const key = `memories/${memory.coupleId}/${memory.memoryId}.md`;
  return { key, metadataKey: `${key}.metadata.json`, body, metadata, fingerprint };
};
