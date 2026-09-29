import { describe, expect, it } from 'vitest';
import type { CardDto } from '@relationship-rag/contracts';
import {
  applyProposal,
  cardFormFrom,
  cardFormKey,
  cardWhen,
  emptyCardForm,
  isCardFormDirty,
  toggleReference,
  toneColor,
  validateCardForm,
  withoutReference,
} from './card-form.js';

const card: CardDto = {
  cardId: '22222222-2222-4222-8222-222222222222',
  senderUserId: 'sender',
  recipientUserId: 'partner',
  recipientDisplayName: 'Sam',
  occasion: 'Cumpleaños',
  tone: 'PLAYFUL',
  locale: 'es',
  memoryIds: ['a'],
  citedMemoryIds: ['a'],
  title: 'Feliz cumpleaños',
  body: 'Que este año tenga menos tormentas.',
  status: 'DRAFT',
  version: 2,
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
};

describe('validateCardForm', () => {
  it('requires the occasion, title, and message the contract needs', () => {
    expect(validateCardForm(emptyCardForm())).toEqual({
      occasion: 'Escribe la ocasión de la tarjeta.',
      title: 'Escribe un título para la tarjeta.',
      body: 'Escribe el mensaje de la tarjeta.',
    });
  });

  it('enforces limits and accepts a complete card', () => {
    expect(
      Object.keys(
        validateCardForm({
          ...cardFormFrom(card),
          occasion: 'o'.repeat(121),
          title: 't'.repeat(121),
          body: 'b'.repeat(10_001),
        }),
      ),
    ).toEqual(['occasion', 'title', 'body']);
    expect(validateCardForm(cardFormFrom(card))).toEqual({});
  });
});

describe('dirty tracking', () => {
  it('treats a new card as dirty once anything is written', () => {
    expect(isCardFormDirty(emptyCardForm(), null)).toBe(false);
    expect(isCardFormDirty({ ...emptyCardForm(), occasion: 'x' }, null)).toBe(true);
    expect(isCardFormDirty({ ...emptyCardForm(), memoryIds: ['a'] }, null)).toBe(true);
  });

  it('compares a saved card with its snapshot', () => {
    const form = cardFormFrom(card);
    expect(isCardFormDirty(form, cardFormKey(form))).toBe(false);
    expect(isCardFormDirty({ ...form, tone: 'GRATEFUL' }, cardFormKey(form))).toBe(true);
  });
});

describe('references and proposals', () => {
  it('limits references to 20 and drops citations with their reference', () => {
    const full = { ...emptyCardForm(), memoryIds: Array.from({ length: 20 }, (_, i) => `m${i}`) };
    expect(toggleReference(full, 'extra')).toBe(full);
    expect(toggleReference(emptyCardForm(), 'a').memoryIds).toEqual(['a']);
    const form = { ...cardFormFrom(card), memoryIds: ['a', 'b'], citedMemoryIds: ['a', 'b'] };
    expect(withoutReference(form, 'a')).toMatchObject({ memoryIds: ['b'], citedMemoryIds: ['b'] });
    expect(toggleReference(form, 'b')).toMatchObject({ memoryIds: ['a'], citedMemoryIds: ['a'] });
  });

  it('replaces the message, keeps a written title, and keeps only chosen citations', () => {
    const proposal = { title: 'Unas líneas', body: 'Nuevo mensaje.', citedMemoryIds: ['a', 'z'] };
    expect(applyProposal({ ...emptyCardForm(), memoryIds: ['a'] }, proposal)).toMatchObject({
      title: 'Unas líneas',
      body: 'Nuevo mensaje.',
      citedMemoryIds: ['a'],
    });
    expect(applyProposal({ ...emptyCardForm(), title: 'Mío' }, proposal).title).toBe('Mío');
  });
});

describe('cardWhen', () => {
  it('describes each server status', () => {
    expect(cardWhen(card, 'UTC')).toBe('Editado el 26 sep 2026');
    expect(cardWhen({ ...card, status: 'QUEUED' }, 'UTC')).toBe('En cola desde el 26 sep 2026');
    expect(
      cardWhen({ ...card, status: 'SCHEDULED', deliveryAt: '2026-10-14T07:00:00.000Z' }, 'UTC'),
    ).toBe('Llegará a partir del 14 de octubre de 2026, 07:00');
    expect(
      cardWhen({ ...card, status: 'SENT', deliveredAt: '2026-09-27T10:00:00.000Z' }, 'UTC'),
    ).toBe('Enviada el 27 sep 2026');
    expect(cardWhen({ ...card, status: 'DELIVERY_FAILED' }, 'UTC')).toBe('Intento del 26 sep 2026');
  });

  it('colours stamps by tone', () => {
    expect(toneColor('GRATEFUL')).toBe('#DCE6D8');
  });
});
