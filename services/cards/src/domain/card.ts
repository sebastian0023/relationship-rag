export type CardStatus = 'DRAFT' | 'SCHEDULED' | 'SENT' | 'DELIVERY_FAILED';

export interface Card {
  readonly cardId: string;
  readonly senderUserId: string;
  readonly recipientUserId: string;
  readonly status: CardStatus;
  readonly title: string;
  readonly body: string;
}

export const canEditCard = (card: Card): boolean => card.status === 'DRAFT';
export const canRequestDelivery = (card: Card): boolean => card.status === 'DRAFT';
