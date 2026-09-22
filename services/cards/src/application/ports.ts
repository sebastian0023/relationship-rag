import type {
  CardDto,
  CardRecipient,
  GeneratedCardDraft,
  GenerateCardRequest,
  SendCardResponse,
} from '@relationship-rag/contracts';
import type { Card } from '../domain/card.js';

export interface SelectedMemory {
  readonly memoryId: string;
  readonly title: string;
  readonly body: string;
  readonly occurredOn: string;
}

export interface CardGenerator {
  generate(
    request: GenerateCardRequest,
    memories: readonly SelectedMemory[],
  ): Promise<GeneratedCardDraft>;
}

export interface CardRepository {
  recipients(coupleId: string, senderUserId: string): Promise<readonly CardRecipient[]>;
  memories(coupleId: string, memoryIds: readonly string[]): Promise<readonly SelectedMemory[]>;
  findByClientRequest(
    coupleId: string,
    senderUserId: string,
    requestId: string,
  ): Promise<Card | null>;
  create(card: Card, clientRequestId: string): Promise<void>;
  find(coupleId: string, senderUserId: string, cardId: string): Promise<Card | null>;
  list(
    coupleId: string,
    senderUserId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ readonly items: readonly Card[]; readonly nextCursor?: string }>;
  update(card: Card, expectedVersion: number): Promise<void>;
  delete(card: Card, expectedVersion: number): Promise<void>;
  findSendRequest(
    coupleId: string,
    senderUserId: string,
    idempotencyKey: string,
  ): Promise<{
    readonly fingerprint: string;
    readonly response: SendCardResponse;
  } | null>;
  approve(
    original: Card,
    approved: Card,
    deliveryId: string,
    idempotencyKey: string,
    fingerprint: string,
    senderDisplayName: string,
  ): Promise<SendCardResponse>;
  senderDisplayName(coupleId: string, senderUserId: string): Promise<string | null>;
}

export interface DeliveryDispatcher {
  dispatch(deliveryId: string, coupleId: string, deliveryAt: string, now: string): Promise<void>;
}

export interface IdGenerator {
  next(): string;
}
export interface Clock {
  now(): string;
}

export const toCardDto = (card: Card): CardDto => ({
  ...card,
  memoryIds: [...card.memoryIds],
  citedMemoryIds: [...card.citedMemoryIds],
});
