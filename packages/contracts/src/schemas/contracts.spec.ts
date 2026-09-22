import { describe, expect, it } from 'vitest';
import {
  createMemoryRequestSchema,
  groundedAnswerSchema,
  createMessageRequestSchema,
  publicRuntimeConfigSchema,
  generatedCardDraftSchema,
  sendCardRequestSchema,
  verifiedIdentitySchema,
} from '../index.js';

describe('createMemoryRequestSchema', () => {
  it('accepts a bilingual text-only memory', () => {
    const result = createMemoryRequestSchema.parse({
      title: 'Nuestro primer viaje',
      occurredOn: '2025-05-14',
      body: 'Fuimos a Puerto Vallarta.',
      locale: 'es',
    });

    expect(result.tags).toEqual([]);
  });

  it('rejects an invalid calendar date', () => {
    expect(() =>
      createMemoryRequestSchema.parse({
        title: 'Impossible date',
        occurredOn: '2025-02-30',
        body: 'This should not pass.',
        locale: 'en',
      }),
    ).toThrow();
  });
});

describe('card contracts', () => {
  it('requires explicit confirmation and a saved version before sending', () => {
    expect(() =>
      sendCardRequestSchema.parse({
        confirmed: false,
        version: 1,
        idempotencyKey: '1234567890123456',
      }),
    ).toThrow();
    expect(
      sendCardRequestSchema.parse({
        confirmed: true,
        version: 2,
        idempotencyKey: '1234567890123456',
      }),
    ).toMatchObject({ confirmed: true, version: 2 });
  });

  it('rejects duplicate model citations', () => {
    const memoryId = '11111111-1111-4111-8111-111111111111';
    expect(() =>
      generatedCardDraftSchema.parse({
        title: 'For you',
        body: 'A memory.',
        citedMemoryIds: [memoryId, memoryId],
      }),
    ).toThrow('Citations must be unique.');
  });
});

describe('authentication contracts', () => {
  it('accepts verified identity claims without client tenancy fields', () => {
    expect(verifiedIdentitySchema.parse({ userId: 'subject-1', groups: ['OWNER'] })).toEqual({
      userId: 'subject-1',
      groups: ['OWNER'],
    });
  });

  it('rejects a runtime configuration without the API scope', () => {
    expect(() =>
      publicRuntimeConfigSchema.parse({
        apiOrigin: 'https://api.example.test',
        authority: 'https://auth.example.test',
        clientId: 'client',
        scope: 'openid profile email',
      }),
    ).toThrow();
  });
});

describe('groundedAnswerSchema', () => {
  it('rejects an asserted answer without a citation', () => {
    expect(() =>
      groundedAnswerSchema.parse({
        answer: 'It happened in May.',
        citations: [],
        abstained: false,
      }),
    ).toThrow('A grounded answer requires at least one citation.');
  });

  it('allows an explicit abstention without citations', () => {
    expect(
      groundedAnswerSchema.parse({
        answer: 'That memory has not been provided.',
        citations: [],
        abstained: true,
      }),
    ).toMatchObject({ abstained: true });
  });
});

describe('chat request contracts', () => {
  it('requires a retry-safe request ID and rejects inverted dates', () => {
    expect(() =>
      createMessageRequestSchema.parse({
        requestId: '82be0dac-3a0a-4c25-8800-1f769687f2dc',
        question: 'When was that?',
        filters: { occurredOnFrom: '2026-01-02', occurredOnTo: '2026-01-01' },
      }),
    ).toThrow('End date must not precede start date.');
  });
});
