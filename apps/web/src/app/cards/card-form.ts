import type { CardDto, CardTone, GeneratedCardDraft, Locale } from '@relationship-rag/contracts';
import { formatInstantWithTime, formatShortInstant } from '../ui/format.js';

export const CARD_LIMITS = { occasion: 120, title: 120, body: 10_000, memories: 20 } as const;

export interface CardFormValue {
  readonly occasion: string;
  readonly tone: CardTone;
  readonly locale: Locale;
  readonly memoryIds: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly citedMemoryIds: readonly string[];
}

export type CardField = 'occasion' | 'title' | 'body';
export type CardFormErrors = Partial<Record<CardField, string>>;

export const TONES: readonly { value: CardTone; label: string; color: string }[] = [
  { value: 'AFFECTIONATE', label: 'Cariñoso', color: '#F4C8C5' },
  { value: 'PLAYFUL', label: 'Juguetón', color: '#F4D7B5' },
  { value: 'GRATEFUL', label: 'Agradecido', color: '#DCE6D8' },
  { value: 'REFLECTIVE', label: 'Reflexivo', color: '#E7DEF2' },
];

export const toneColor = (tone: CardTone): string =>
  TONES.find((option) => option.value === tone)?.color ?? '#F3ECE4';

export const emptyCardForm = (): CardFormValue => ({
  occasion: '',
  tone: 'AFFECTIONATE',
  locale: 'es',
  memoryIds: [],
  title: '',
  body: '',
  citedMemoryIds: [],
});

export const cardFormFrom = (card: CardDto): CardFormValue => ({
  occasion: card.occasion,
  tone: card.tone,
  locale: card.locale,
  memoryIds: [...card.memoryIds],
  title: card.title,
  body: card.body,
  citedMemoryIds: [...card.citedMemoryIds],
});

export const cardFormKey = (form: CardFormValue): string =>
  JSON.stringify([
    form.occasion,
    form.tone,
    form.locale,
    form.memoryIds,
    form.title,
    form.body,
    form.citedMemoryIds,
  ]);

/** A new card counts as changed once anything was written or chosen. */
export const isCardFormDirty = (form: CardFormValue, savedKey: string | null): boolean =>
  savedKey === null
    ? form.occasion.trim() !== '' ||
      form.title.trim() !== '' ||
      form.body.trim() !== '' ||
      form.memoryIds.length > 0
    : cardFormKey(form) !== savedKey;

/** Saving requires the fields the contract requires: occasion, title, and message. */
export const validateCardForm = (form: CardFormValue): CardFormErrors => {
  const errors: { -readonly [K in CardField]?: string } = {};
  if (form.occasion.trim() === '') errors.occasion = 'Escribe la ocasión de la tarjeta.';
  else if (form.occasion.trim().length > CARD_LIMITS.occasion)
    errors.occasion = 'La ocasión puede tener hasta 120 caracteres.';
  if (form.title.trim() === '') errors.title = 'Escribe un título para la tarjeta.';
  else if (form.title.trim().length > CARD_LIMITS.title)
    errors.title = 'El título puede tener hasta 120 caracteres.';
  if (form.body.trim() === '') errors.body = 'Escribe el mensaje de la tarjeta.';
  else if (form.body.trim().length > CARD_LIMITS.body)
    errors.body = 'El mensaje puede tener hasta 10 000 caracteres.';
  return errors;
};

/** Removing a reference memory also removes it from the citations of the message. */
export const withoutReference = (form: CardFormValue, memoryId: string): CardFormValue => ({
  ...form,
  memoryIds: form.memoryIds.filter((id) => id !== memoryId),
  citedMemoryIds: form.citedMemoryIds.filter((id) => id !== memoryId),
});

export const toggleReference = (form: CardFormValue, memoryId: string): CardFormValue => {
  if (form.memoryIds.includes(memoryId)) return withoutReference(form, memoryId);
  if (form.memoryIds.length >= CARD_LIMITS.memories) return form;
  return { ...form, memoryIds: [...form.memoryIds, memoryId] };
};

/**
 * Puts an accepted proposal into the card. The message is replaced; a title the member already
 * wrote is kept. Citations are limited to the chosen reference memories.
 */
export const applyProposal = (
  form: CardFormValue,
  proposal: GeneratedCardDraft,
): CardFormValue => ({
  ...form,
  body: proposal.body,
  title: form.title.trim() === '' ? proposal.title : form.title,
  citedMemoryIds: proposal.citedMemoryIds.filter((id) => form.memoryIds.includes(id)),
});

/** Secondary line of a card in the list, from the server's status and timestamps. */
export const cardWhen = (card: CardDto, timeZone?: string): string => {
  switch (card.status) {
    case 'DRAFT':
      return `Editado el ${formatShortInstant(card.updatedAt, timeZone)}`;
    case 'QUEUED':
      return `En cola desde el ${formatShortInstant(card.updatedAt, timeZone)}`;
    case 'SCHEDULED':
      return card.deliveryAt === undefined
        ? 'Programada'
        : `Llegará a partir del ${formatInstantWithTime(card.deliveryAt, timeZone)}`;
    case 'SENT':
      return `Enviada el ${formatShortInstant(card.deliveredAt ?? card.updatedAt, timeZone)}`;
    case 'DELIVERY_FAILED':
      return `Intento del ${formatShortInstant(card.updatedAt, timeZone)}`;
  }
};
