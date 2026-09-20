import { describe, expect, it } from 'vitest';
import { canEditCard, canRequestDelivery, type Card } from './card.js';

const draft: Card = {
  cardId: 'card-1',
  senderUserId: 'owner-1',
  recipientUserId: 'partner-1',
  status: 'DRAFT',
  title: 'For you',
  body: 'A saved draft.',
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
