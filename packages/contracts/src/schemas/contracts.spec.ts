import { describe, expect, it } from 'vitest';
import {
  createMemoryRequestSchema,
  groundedAnswerSchema,
  publicRuntimeConfigSchema,
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
