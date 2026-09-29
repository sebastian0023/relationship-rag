import { describe, expect, it } from 'vitest';
import type { MemoryDto } from '@relationship-rag/contracts';
import {
  addTag,
  emptyMemoryForm,
  errorCount,
  errorSummary,
  isMemoryFormDirty,
  memoryFormFrom,
  memoryFormKey,
  memoryRequestFrom,
  validateMemoryForm,
  type MemoryFormValue,
} from './memory-form.js';

const filled = (overrides: Partial<MemoryFormValue> = {}): MemoryFormValue => ({
  ...emptyMemoryForm(),
  title: 'La tarde del museo',
  occurredOn: '2025-11-03',
  body: 'Nos quedamos frente al péndulo.',
  ...overrides,
});

describe('validateMemoryForm', () => {
  it('requires a title, a date, and the memory text', () => {
    const errors = validateMemoryForm(emptyMemoryForm());
    expect(errors).toEqual({
      title: 'Escribe un título para el recuerdo.',
      occurredOn: 'Elige la fecha del recuerdo.',
      body: 'Escribe el recuerdo. Es lo que guardamos y lo que la IA podrá consultar.',
    });
    expect(errorCount(errors)).toBe(3);
    expect(errorSummary(errors)).toBe('Hay 3 campos por revisar. Tu texto sigue aquí.');
  });

  it('enforces the contract limits', () => {
    const errors = validateMemoryForm(
      filled({
        title: 'a'.repeat(121),
        location: 'b'.repeat(201),
        body: 'c'.repeat(10_001),
        category: 'd'.repeat(41),
        tagInput: 'e'.repeat(41),
      }),
    );
    expect(Object.keys(errors).sort()).toEqual(['body', 'category', 'location', 'tags', 'title']);
  });

  it('rejects a pending tag when the list is full', () => {
    const tags = Array.from({ length: 20 }, (_, index) => `t${index}`);
    expect(validateMemoryForm(filled({ tags, tagInput: 'otra' })).tags).toBe(
      'Ya añadiste 20 etiquetas, el máximo.',
    );
  });

  it('accepts a complete memory and summarises a single error', () => {
    expect(validateMemoryForm(filled())).toEqual({});
    expect(errorSummary({ title: 'x' })).toBe('Hay 1 campo por revisar. Tu texto sigue aquí.');
  });
});

describe('addTag', () => {
  it('adds a trimmed tag and clears the input', () => {
    const result = addTag(filled({ tagInput: ' museo, ' }));
    expect(result).toMatchObject({
      ok: true,
      tag: 'museo',
      form: { tags: ['museo'], tagInput: '' },
    });
  });

  it('ignores empty input and rejects duplicates, long tags, and a full list', () => {
    expect(addTag(filled({ tagInput: '  ' }))).toEqual({ ok: false, error: null });
    expect(addTag(filled({ tags: ['Museo'], tagInput: 'museo' }))).toEqual({
      ok: false,
      error: 'Esa etiqueta ya está en la lista.',
    });
    expect(addTag(filled({ tagInput: 'x'.repeat(41) }))).toMatchObject({ ok: false });
    const tags = Array.from({ length: 20 }, (_, index) => `t${index}`);
    expect(addTag(filled({ tags, tagInput: 'otra' }))).toMatchObject({ ok: false });
  });
});

describe('dirty tracking and requests', () => {
  const memory: MemoryDto = {
    memoryId: '11111111-1111-4111-8111-111111111111',
    coupleId: 'couple',
    createdBy: 'sender',
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ingestionStatus: 'INDEXED',
    version: 2,
    photos: [],
    title: 'Fin de semana en el lago',
    occurredOn: '2026-06-20',
    body: 'Remamos hasta la isla.',
    locale: 'es',
    tags: ['viaje'],
    category: 'Viajes',
  };

  it('is clean when loaded and dirty after an edit or a typed tag', () => {
    const form = memoryFormFrom(memory);
    const key = memoryFormKey(form);
    expect(form.location).toBe('');
    expect(isMemoryFormDirty(form, key)).toBe(false);
    expect(isMemoryFormDirty({ ...form, title: 'Otro' }, key)).toBe(true);
    expect(isMemoryFormDirty({ ...form, tagInput: 'lago' }, key)).toBe(true);
  });

  it('trims fields, omits empty optional fields, and keeps a pending tag', () => {
    expect(
      memoryRequestFrom(filled({ title: '  Museo ', location: ' ', tags: ['a'], tagInput: 'b' })),
    ).toEqual({
      title: 'Museo',
      occurredOn: '2025-11-03',
      body: 'Nos quedamos frente al péndulo.',
      locale: 'es',
      tags: ['a', 'b'],
    });
    expect(memoryRequestFrom(filled({ location: 'Madrid', category: 'Paseos' }))).toMatchObject({
      location: 'Madrid',
      category: 'Paseos',
    });
  });
});
