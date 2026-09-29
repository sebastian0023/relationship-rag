import type { MemoryDto, MemoryRetrievalFilters } from '@relationship-rag/contracts';
import { formatShortDate } from '../ui/format.js';

export const QUESTION_MAX = 2000;

export interface ChatFilters {
  readonly from: string;
  readonly to: string;
  readonly category: string;
  readonly tags: readonly string[];
}

export interface FilterChip {
  readonly key: string;
  readonly label: string;
  readonly removeLabel: string;
  readonly without: ChatFilters;
}

export const noFilters = (): ChatFilters => ({ from: '', to: '', category: '', tags: [] });

export const rangeError = (filters: ChatFilters): string | null =>
  filters.from !== '' && filters.to !== '' && filters.from > filters.to
    ? 'La fecha inicial es posterior a la final.'
    : null;

/** Request filters, or `undefined` when nothing narrows the search. */
export const retrievalFilters = (filters: ChatFilters): MemoryRetrievalFilters | undefined => {
  const result: MemoryRetrievalFilters = {
    ...(filters.from === '' ? {} : { occurredOnFrom: filters.from }),
    ...(filters.to === '' ? {} : { occurredOnTo: filters.to }),
    ...(filters.category === '' ? {} : { category: filters.category }),
    ...(filters.tags.length === 0 ? {} : { tags: [...filters.tags] }),
  };
  return Object.keys(result).length === 0 ? undefined : result;
};

export const filterChips = (filters: ChatFilters): readonly FilterChip[] => [
  ...(filters.from === ''
    ? []
    : [
        {
          key: 'from',
          label: `Desde ${formatShortDate(filters.from)}`,
          removeLabel: `Quitar filtro desde ${formatShortDate(filters.from)}`,
          without: { ...filters, from: '' },
        },
      ]),
  ...(filters.to === ''
    ? []
    : [
        {
          key: 'to',
          label: `Hasta ${formatShortDate(filters.to)}`,
          removeLabel: `Quitar filtro hasta ${formatShortDate(filters.to)}`,
          without: { ...filters, to: '' },
        },
      ]),
  ...(filters.category === ''
    ? []
    : [
        {
          key: 'category',
          label: filters.category,
          removeLabel: `Quitar categoría ${filters.category}`,
          without: { ...filters, category: '' },
        },
      ]),
  ...filters.tags.map((tag) => ({
    key: `tag:${tag}`,
    label: `#${tag}`,
    removeLabel: `Quitar etiqueta ${tag}`,
    without: { ...filters, tags: filters.tags.filter((item) => item !== tag) },
  })),
];

/** Category and tag choices offered in the filter panel, from the memories loaded so far. */
export const filterOptions = (
  memories: readonly MemoryDto[],
  selected: ChatFilters,
): { readonly categories: readonly string[]; readonly tags: readonly string[] } => {
  const sort = (values: Iterable<string>) =>
    [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'));
  return {
    categories: sort([
      ...memories.flatMap((memory) => (memory.category === undefined ? [] : [memory.category])),
      ...(selected.category === '' ? [] : [selected.category]),
    ]),
    tags: sort([...memories.flatMap((memory) => memory.tags), ...selected.tags]),
  };
};

/** The server names untitled conversations in English; show them in Spanish. */
export const conversationTitle = (title: string): string =>
  title === 'New conversation' ? 'Nueva conversación' : title;
