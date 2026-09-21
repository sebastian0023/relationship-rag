import { describe, expect, it } from 'vitest';
import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockMemoryRetriever, buildRetrievalFilter } from './bedrock-memory-retriever.js';

describe('buildRetrievalFilter', () => {
  it('uses a direct couple predicate when no optional filter is present', () => {
    expect(buildRetrievalFilter('couple-a')).toEqual({
      equals: { key: 'coupleId', value: 'couple-a' },
    });
  });

  it('combines optional filters with the mandatory couple predicate', () => {
    expect(
      buildRetrievalFilter('couple-a', { occurredOnFrom: '2026-01-01', tags: ['Trip', 'Food'] }),
    ).toMatchObject({
      andAll: [
        { equals: { key: 'coupleId', value: 'couple-a' } },
        { greaterThanOrEquals: { key: 'occurredOn', value: 1767225600 } },
        { orAll: [{ listContains: { key: 'tags' } }, { listContains: { key: 'tags' } }] },
      ],
    });
  });

  it('applies date, category, and tag filters together', () => {
    expect(
      buildRetrievalFilter('couple-a', {
        occurredOnTo: '2026-12-31',
        category: 'Trips',
        tags: [],
      }),
    ).toMatchObject({
      andAll: [
        { equals: { key: 'coupleId', value: 'couple-a' } },
        { lessThanOrEquals: { key: 'occurredOn', value: 1798675200 } },
        { equals: { key: 'category' } },
      ],
    });
  });

  it('returns only current, canonical, unique retrieval results', async () => {
    const client = {
      send: async () => ({
        retrievalResults: [
          { metadata: { memoryId: 'valid', fingerprint: 'current' }, score: 0.9 },
          { metadata: { memoryId: 'valid', fingerprint: 'current' }, score: 0.8 },
          { metadata: { memoryId: 'stale', fingerprint: 'old' }, score: 0.7 },
          { metadata: { memoryId: 'missing-fingerprint' }, score: 0.6 },
          { metadata: { memoryId: 'missing', fingerprint: 'none' }, score: 0.5 },
        ],
      }),
    } as unknown as BedrockAgentRuntimeClient;
    const retriever = new BedrockMemoryRetriever(
      'kb-id',
      {
        find: async (_coupleId, memoryId) =>
          memoryId === 'valid'
            ? {
                memoryId,
                coupleId: 'couple-a',
                title: 'A verified memory',
                body: 'Canonical content',
                fingerprint: 'current',
              }
            : memoryId === 'stale'
              ? {
                  memoryId,
                  coupleId: 'couple-a',
                  title: 'Changed memory',
                  body: 'New content',
                  fingerprint: 'new',
                }
              : null,
      },
      client,
    );

    await expect(retriever.retrieve('couple-a', 'Tell me about it')).resolves.toEqual([
      {
        memoryId: 'valid',
        title: 'A verified memory',
        content: 'Canonical content',
        relevance: 0.9,
      },
    ]);
  });
});
