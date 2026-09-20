export interface DeliveryRequest {
  readonly cardId: string;
  readonly recipientUserId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
}

export interface DeliveryRepository {
  deliverOnce(request: DeliveryRequest): Promise<'DELIVERED' | 'ALREADY_DELIVERED'>;
}
