import type { CreateMemoryRequest, Locale, MemoryDto } from '@relationship-rag/contracts';

export const MEMORY_LIMITS = {
  title: 120,
  location: 200,
  body: 10_000,
  category: 40,
  tag: 40,
  tags: 20,
} as const;

export interface MemoryFormValue {
  readonly title: string;
  readonly occurredOn: string;
  readonly location: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly tagInput: string;
  readonly category: string;
  readonly locale: Locale;
}

export type MemoryField = 'title' | 'occurredOn' | 'location' | 'body' | 'tags' | 'category';
export type MemoryFormErrors = Partial<Record<MemoryField, string>>;

export const emptyMemoryForm = (): MemoryFormValue => ({
  title: '',
  occurredOn: '',
  location: '',
  body: '',
  tags: [],
  tagInput: '',
  category: '',
  locale: 'es',
});

export const memoryFormFrom = (memory: MemoryDto): MemoryFormValue => ({
  title: memory.title,
  occurredOn: memory.occurredOn,
  location: memory.location ?? '',
  body: memory.body,
  tags: [...memory.tags],
  tagInput: '',
  category: memory.category ?? '',
  locale: memory.locale,
});

/** Stable snapshot used to detect unsaved changes. */
export const memoryFormKey = (form: MemoryFormValue): string =>
  JSON.stringify([
    form.title,
    form.occurredOn,
    form.location,
    form.body,
    form.tags,
    form.category,
    form.locale,
  ]);

export const isMemoryFormDirty = (form: MemoryFormValue, savedKey: string): boolean =>
  memoryFormKey(form) !== savedKey || form.tagInput.trim() !== '';

export const validateMemoryForm = (form: MemoryFormValue): MemoryFormErrors => {
  const errors: { -readonly [K in MemoryField]?: string } = {};
  if (form.title.trim() === '') errors.title = 'Escribe un título para el recuerdo.';
  else if (form.title.trim().length > MEMORY_LIMITS.title)
    errors.title = 'El título puede tener hasta 120 caracteres.';
  if (form.occurredOn === '') errors.occurredOn = 'Elige la fecha del recuerdo.';
  if (form.location.trim().length > MEMORY_LIMITS.location)
    errors.location = 'El lugar puede tener hasta 200 caracteres.';
  if (form.body.trim() === '')
    errors.body = 'Escribe el recuerdo. Es lo que guardamos y lo que la IA podrá consultar.';
  else if (form.body.trim().length > MEMORY_LIMITS.body)
    errors.body = 'El recuerdo puede tener hasta 10 000 caracteres.';
  if (form.category.trim().length > MEMORY_LIMITS.category)
    errors.category = 'La categoría puede tener hasta 40 caracteres.';
  const pending = form.tagInput.trim();
  if (pending.length > MEMORY_LIMITS.tag)
    errors.tags = 'Cada etiqueta puede tener hasta 40 caracteres.';
  else if (pending !== '' && form.tags.length >= MEMORY_LIMITS.tags)
    errors.tags = 'Ya añadiste 20 etiquetas, el máximo.';
  return errors;
};

export const errorCount = (errors: MemoryFormErrors): number =>
  Object.values(errors).filter((message) => message !== undefined).length;

export const errorSummary = (errors: MemoryFormErrors): string => {
  const count = errorCount(errors);
  return count === 1
    ? 'Hay 1 campo por revisar. Tu texto sigue aquí.'
    : `Hay ${count} campos por revisar. Tu texto sigue aquí.`;
};

export type TagResult =
  | { readonly ok: true; readonly form: MemoryFormValue; readonly tag: string }
  | { readonly ok: false; readonly error: string | null };

/** Adds the typed tag. A trailing comma is ignored; an empty input is a no-op without error. */
export const addTag = (form: MemoryFormValue): TagResult => {
  const tag = form.tagInput.trim().replace(/,$/, '').trim();
  if (tag === '') return { ok: false, error: null };
  if (tag.length > MEMORY_LIMITS.tag)
    return { ok: false, error: 'Cada etiqueta puede tener hasta 40 caracteres.' };
  if (form.tags.length >= MEMORY_LIMITS.tags)
    return { ok: false, error: 'Ya añadiste 20 etiquetas, el máximo.' };
  if (form.tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase()))
    return { ok: false, error: 'Esa etiqueta ya está en la lista.' };
  return { ok: true, form: { ...form, tags: [...form.tags, tag], tagInput: '' }, tag };
};

/** The request body. A tag still in the input is saved too, so nothing typed is lost. */
export const memoryRequestFrom = (form: MemoryFormValue): CreateMemoryRequest => {
  const pending = addTag(form);
  const tags = pending.ok ? pending.form.tags : form.tags;
  const location = form.location.trim();
  const category = form.category.trim();
  return {
    title: form.title.trim(),
    occurredOn: form.occurredOn,
    body: form.body.trim(),
    locale: form.locale,
    tags: [...tags],
    ...(location === '' ? {} : { location }),
    ...(category === '' ? {} : { category }),
  };
};
