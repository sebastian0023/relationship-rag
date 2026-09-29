import { describe, expect, it } from 'vitest';
import type { MemoryDto } from '@relationship-rag/contracts';
import {
  conversationTitle,
  filterChips,
  filterOptions,
  noFilters,
  rangeError,
  retrievalFilters,
} from './filters.js';

describe('retrievalFilters', () => {
  it('omits empty filters entirely', () => {
    expect(retrievalFilters(noFilters())).toBeUndefined();
  });

  it('maps each chosen filter to the contract', () => {
    expect(
      retrievalFilters({
        from: '2026-01-01',
        to: '2026-06-30',
        category: 'Viajes',
        tags: ['lago'],
      }),
    ).toEqual({
      occurredOnFrom: '2026-01-01',
      occurredOnTo: '2026-06-30',
      category: 'Viajes',
      tags: ['lago'],
    });
  });
});

describe('rangeError', () => {
  it('rejects a start date after the end date', () => {
    expect(rangeError({ ...noFilters(), from: '2026-07-01', to: '2026-06-01' })).toBe(
      'La fecha inicial es posterior a la final.',
    );
    expect(rangeError({ ...noFilters(), from: '2026-06-01', to: '2026-06-01' })).toBeNull();
    expect(rangeError({ ...noFilters(), from: '2026-06-01' })).toBeNull();
  });
});

describe('filterChips', () => {
  it('lists removable chips that each drop only their own filter', () => {
    const filters = { from: '2026-03-01', to: '', category: 'Viajes', tags: ['lago', 'isla'] };
    const chips = filterChips(filters);
    expect(chips.map((chip) => chip.label)).toEqual([
      'Desde 1 mar 2026',
      'Viajes',
      '#lago',
      '#isla',
    ]);
    expect(chips[2]?.removeLabel).toBe('Quitar etiqueta lago');
    expect(chips[2]?.without).toEqual({ ...filters, tags: ['isla'] });
    expect(chips[0]?.without.from).toBe('');
  });
});

describe('filterOptions', () => {
  it('offers unique sorted categories and tags, keeping current selections', () => {
    const memories = [
      { category: 'Viajes', tags: ['lago', 'verano'] },
      { tags: ['cocina', 'lago'] },
    ] as unknown as MemoryDto[];
    expect(
      filterOptions(memories, { ...noFilters(), category: 'Casa', tags: ['antiguo'] }),
    ).toEqual({
      categories: ['Casa', 'Viajes'],
      tags: ['antiguo', 'cocina', 'lago', 'verano'],
    });
  });
});

describe('conversationTitle', () => {
  it('translates the server default title only', () => {
    expect(conversationTitle('New conversation')).toBe('Nueva conversación');
    expect(conversationTitle('¿Qué hicimos en el lago?')).toBe('¿Qué hicimos en el lago?');
  });
});
