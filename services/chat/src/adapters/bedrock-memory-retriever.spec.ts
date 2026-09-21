import { describe, expect, it } from 'vitest';
import { buildRetrievalFilter } from './bedrock-memory-retriever.js';

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
});
