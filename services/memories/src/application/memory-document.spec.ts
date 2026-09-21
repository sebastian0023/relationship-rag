import { describe, expect, it } from 'vitest';
import { normalizeMemoryDocument } from './memory-document.js';
import type { Memory } from '../domain/memory.js';

const memory: Memory = {
  memoryId: 'c8e9bd6c-29cc-4c84-8799-6210fb7d8520',
  coupleId: 'couple-a',
  createdBy: 'member-a',
  title: 'Cena especial',
  occurredOn: '2025-02-14',
  body: 'Cocinamos mole juntos.',
  locale: 'es',
  tags: ['Food', 'celebración'],
  category: 'Milestone',
  createdAt: '2025-02-14T00:00:00.000Z',
  updatedAt: '2025-02-14T00:00:00.000Z',
  version: 1,
  photos: [],
  ingestionStatus: 'PENDING',
};
describe('normalizeMemoryDocument', () => {
  it('is deterministic and excludes photo storage fields', () => {
    const document = normalizeMemoryDocument(memory);
    expect(document.body).toContain('Cocinamos mole juntos.');
    expect(document.body).not.toContain('staging');
    expect(document.metadata).toContain('couple-a');
    expect(
      normalizeMemoryDocument({
        ...memory,
        version: 9,
        photos: [
          { photoId: 'x', contentType: 'image/jpeg', status: 'READY', stagingKey: 'private' },
        ],
      }),
    ).toMatchObject({ fingerprint: document.fingerprint });
  });
  it('uses compact hashes so maximum valid tags fit the metadata limit', () => {
    const document = normalizeMemoryDocument({
      ...memory,
      tags: Array.from({ length: 20 }, (_, index) => `étiquette-${index}-${'x'.repeat(30)}`),
    });
    expect(Buffer.byteLength(document.metadata, 'utf8')).toBeLessThanOrEqual(1024);
  });
});
