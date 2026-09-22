import { createHash } from 'node:crypto';
import type {
  CardDto,
  GenerateCardRequest,
  GeneratedCardDraft,
  SaveCardRequest,
  SendCardRequest,
  SendCardResponse,
  UpdateCardRequest,
} from '@relationship-rag/contracts';
import { ConflictError, DomainError, ResourceNotFoundError } from '@relationship-rag/domain';
import { approveCard, canEditCard, canRequestDelivery, type Card } from '../domain/card.js';
import type {
  CardGenerator,
  CardRepository,
  Clock,
  DeliveryDispatcher,
  IdGenerator,
} from './ports.js';
import { toCardDto } from './ports.js';

const ensureCitations = (selected: readonly string[], cited: readonly string[]): void => {
  const allowed = new Set(selected);
  if (cited.some((id) => !allowed.has(id))) {
    throw new DomainError('INVALID_CITATION', 'The draft cited a memory that was not selected.');
  }
  if (selected.length > 0 && cited.length === 0) {
    throw new DomainError('UNGROUNDED_DRAFT', 'A memory-based draft requires a citation.');
  }
  if (selected.length === 0 && cited.length > 0) {
    throw new DomainError('INVALID_CITATION', 'A generic draft cannot cite memories.');
  }
};

export class CardService {
  public constructor(
    private readonly repository: CardRepository,
    private readonly generator: CardGenerator,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly dispatcher?: DeliveryDispatcher,
  ) {}

  public recipients(coupleId: string, senderUserId: string) {
    return this.repository.recipients(coupleId, senderUserId);
  }

  public async generate(
    coupleId: string,
    senderUserId: string,
    request: GenerateCardRequest,
  ): Promise<GeneratedCardDraft> {
    await this.requireRecipient(coupleId, senderUserId, request.recipientUserId);
    const memories = await this.repository.memories(coupleId, request.memoryIds);
    if (memories.length !== request.memoryIds.length) throw new ResourceNotFoundError();
    const inputSize = memories.reduce(
      (size, memory) => size + memory.title.length + memory.body.length,
      0,
    );
    if (inputSize > 40_000) {
      throw new DomainError('CONTEXT_TOO_LARGE', 'Select fewer or shorter memories.');
    }
    const draft = await this.generator.generate(request, memories);
    ensureCitations(request.memoryIds, draft.citedMemoryIds);
    return draft;
  }

  public async save(
    coupleId: string,
    senderUserId: string,
    request: SaveCardRequest,
  ): Promise<CardDto> {
    const replay = await this.repository.findByClientRequest(
      coupleId,
      senderUserId,
      request.clientRequestId,
    );
    if (replay !== null) {
      const same =
        replay.recipientUserId === request.recipientUserId &&
        replay.occasion === request.occasion &&
        replay.tone === request.tone &&
        replay.locale === request.locale &&
        replay.title === request.title &&
        replay.body === request.body &&
        JSON.stringify(replay.memoryIds) === JSON.stringify(request.memoryIds) &&
        JSON.stringify(replay.citedMemoryIds) === JSON.stringify(request.citedMemoryIds);
      if (!same) throw new ConflictError();
      return toCardDto(replay);
    }
    const recipient = await this.requireRecipient(coupleId, senderUserId, request.recipientUserId);
    const memories = await this.repository.memories(coupleId, request.memoryIds);
    if (memories.length !== request.memoryIds.length) throw new ResourceNotFoundError();
    ensureCitations(request.memoryIds, request.citedMemoryIds);
    const now = this.clock.now();
    const card: Card = {
      cardId: this.ids.next(),
      coupleId,
      senderUserId,
      recipientUserId: recipient.userId,
      recipientDisplayName: recipient.displayName,
      occasion: request.occasion,
      tone: request.tone,
      locale: request.locale,
      memoryIds: request.memoryIds,
      citedMemoryIds: request.citedMemoryIds,
      title: request.title,
      body: request.body,
      status: 'DRAFT',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(card, request.clientRequestId);
    return toCardDto(card);
  }

  public async list(coupleId: string, senderUserId: string, cursor?: string, limit?: number) {
    const result = await this.repository.list(coupleId, senderUserId, cursor, limit);
    return {
      items: result.items.map(toCardDto),
      ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
    };
  }

  public async get(coupleId: string, senderUserId: string, cardId: string): Promise<CardDto> {
    return toCardDto(await this.requireCard(coupleId, senderUserId, cardId));
  }

  public async update(
    coupleId: string,
    senderUserId: string,
    cardId: string,
    request: UpdateCardRequest,
  ): Promise<CardDto> {
    const card = await this.requireCard(coupleId, senderUserId, cardId);
    if (!canEditCard(card) || card.version !== request.version) throw new ConflictError();
    const memories = await this.repository.memories(coupleId, request.memoryIds);
    if (memories.length !== request.memoryIds.length) throw new ResourceNotFoundError();
    ensureCitations(request.memoryIds, request.citedMemoryIds);
    const updated: Card = {
      ...card,
      ...request,
      version: card.version + 1,
      updatedAt: this.clock.now(),
    };
    await this.repository.update(updated, request.version);
    return toCardDto(updated);
  }

  public async delete(
    coupleId: string,
    senderUserId: string,
    cardId: string,
    version: number,
  ): Promise<void> {
    const card = await this.requireCard(coupleId, senderUserId, cardId);
    if (!canEditCard(card) || card.version !== version) throw new ConflictError();
    await this.repository.delete(card, version);
  }

  public async send(
    coupleId: string,
    senderUserId: string,
    cardId: string,
    request: SendCardRequest,
  ): Promise<SendCardResponse> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ cardId, ...request }))
      .digest('hex');
    const replay = await this.repository.findSendRequest(
      coupleId,
      senderUserId,
      request.idempotencyKey,
    );
    if (replay !== null) {
      if (replay.fingerprint !== fingerprint) throw new ConflictError();
      return replay.response;
    }
    const card = await this.requireCard(coupleId, senderUserId, cardId);
    if (!canRequestDelivery(card) || card.version !== request.version) throw new ConflictError();
    const now = this.clock.now();
    const deliveryAt = request.deliveryAt ?? now;
    if (request.deliveryAt !== undefined && Date.parse(deliveryAt) <= Date.parse(now)) {
      throw new DomainError('INVALID_DELIVERY_TIME', 'Scheduled delivery must be in the future.');
    }
    const senderDisplayName = await this.repository.senderDisplayName(coupleId, senderUserId);
    if (senderDisplayName === null) throw new ResourceNotFoundError();
    const approved = approveCard(card, deliveryAt, now);
    const deliveryId = this.ids.next();
    const response = await this.repository.approve(
      card,
      approved,
      deliveryId,
      request.idempotencyKey,
      fingerprint,
      senderDisplayName,
    );
    await this.dispatcher?.dispatch(deliveryId, coupleId, deliveryAt, now).catch(() => undefined);
    return response;
  }

  private async requireRecipient(coupleId: string, senderUserId: string, recipientUserId: string) {
    const recipient = (await this.repository.recipients(coupleId, senderUserId)).find(
      (item) => item.userId === recipientUserId,
    );
    if (recipient === undefined) throw new ResourceNotFoundError();
    return recipient;
  }

  private async requireCard(coupleId: string, senderUserId: string, cardId: string): Promise<Card> {
    const card = await this.repository.find(coupleId, senderUserId, cardId);
    if (card === null) throw new ResourceNotFoundError();
    return card;
  }
}
