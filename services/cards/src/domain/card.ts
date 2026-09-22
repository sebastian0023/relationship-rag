export type CardStatus = 'DRAFT' | 'QUEUED' | 'SCHEDULED' | 'SENT' | 'DELIVERY_FAILED';

export interface Card {
  readonly cardId: string;
  readonly coupleId: string;
  readonly senderUserId: string;
  readonly recipientUserId: string;
  readonly recipientDisplayName: string;
  readonly status: CardStatus;
  readonly occasion: string;
  readonly tone: 'AFFECTIONATE' | 'PLAYFUL' | 'GRATEFUL' | 'REFLECTIVE';
  readonly locale: 'en' | 'es';
  readonly memoryIds: readonly string[];
  readonly citedMemoryIds: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deliveryAt?: string;
  readonly deliveredAt?: string;
}

export const canEditCard = (card: Card): boolean => card.status === 'DRAFT';
export const canRequestDelivery = (card: Card): boolean => card.status === 'DRAFT';

export const approveCard = (card: Card, deliveryAt: string, now: string): Card => ({
  ...card,
  status: deliveryAt > now ? 'SCHEDULED' : 'QUEUED',
  deliveryAt,
  updatedAt: now,
  version: card.version + 1,
});
