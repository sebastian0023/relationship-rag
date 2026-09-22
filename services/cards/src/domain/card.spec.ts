import { describe, expect, it } from 'vitest';
import { canEditCard, canRequestDelivery, type Card } from './card.js';

const draft: Card = {
  cardId: 'card-1',
  coupleId: 'couple-1',
  senderUserId: 'owner-1',
  recipientUserId: 'partner-1',
  recipientDisplayName: 'Partner',
  status: 'DRAFT',
  occasion: 'Anniversary',
  tone: 'AFFECTIONATE',
  locale: 'en',
  memoryIds: [],
  citedMemoryIds: [],
  title: 'For you',
  body: 'A saved draft.',
  version: 1,
  createdAt: '2026-09-21T12:00:00.000Z',
  updatedAt: '2026-09-21T12:00:00.000Z',
};

describe('card state policy', () => {
  it('allows an explicitly saved draft to be edited or sent', () => {
    expect(canEditCard(draft)).toBe(true);
    expect(canRequestDelivery(draft)).toBe(true);
  });

  it('does not allow a sent card to be edited or sent again', () => {
    const sent: Card = { ...draft, status: 'SENT' };
    expect(canEditCard(sent)).toBe(false);
    expect(canRequestDelivery(sent)).toBe(false);
  });
});
