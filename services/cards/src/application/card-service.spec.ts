import { describe, expect, it } from 'vitest';
import { CardService } from './card-service.js';
import type { CardGenerator, CardRepository } from './ports.js';
import type { Card } from '../domain/card.js';
import type {
  CardRecipient,
  GenerateCardRequest,
  SendCardResponse,
} from '@relationship-rag/contracts';

const recipient: CardRecipient = { userId: 'partner', displayName: 'Sam' };
const generated = {
  title: 'For you',
  body: 'Our beach day still makes me smile.',
  citedMemoryIds: ['11111111-1111-4111-8111-111111111111'],
};

class FakeRepository implements CardRepository {
  public card: Card | null = null;
  public send: { fingerprint: string; response: SendCardResponse } | null = null;
  public availableRecipients: readonly CardRecipient[] = [recipient];
  public requestReplay = false;
  public omitMemory = false;
  public senderName: string | null = 'Alex';
  public nextCursor: string | undefined;
  public recipients(): Promise<readonly CardRecipient[]> {
    return Promise.resolve(this.availableRecipients);
  }
  public memories(_couple: string, ids: readonly string[]) {
    const result = ids.map((memoryId) => ({
      memoryId,
      title: 'Beach',
      body: 'We went to the beach.',
      occurredOn: '2025-05-01',
    }));
    return Promise.resolve(this.omitMemory ? result.slice(1) : result);
  }
  public findByClientRequest() {
    return Promise.resolve(this.requestReplay ? this.card : null);
  }
  public create(card: Card) {
    this.card = card;
    return Promise.resolve();
  }
  public find() {
    return Promise.resolve(this.card);
  }
  public list() {
    return Promise.resolve({
      items: this.card === null ? [] : [this.card],
      ...(this.nextCursor === undefined ? {} : { nextCursor: this.nextCursor }),
    });
  }
  public update(card: Card) {
    this.card = card;
    return Promise.resolve();
  }
  public delete() {
    this.card = null;
    return Promise.resolve();
  }
  public findSendRequest() {
    return Promise.resolve(this.send);
  }
  public approve(
    _original: Card,
    approved: Card,
    deliveryId: string,
    _key: string,
    fingerprint: string,
  ) {
    this.card = approved;
    const response: SendCardResponse = {
      deliveryId,
      cardId: approved.cardId,
      status: approved.status === 'SCHEDULED' ? 'SCHEDULED' : 'QUEUED',
      deliveryAt: approved.deliveryAt!,
    };
    this.send = { fingerprint, response };
    return Promise.resolve(response);
  }
  public senderDisplayName() {
    return Promise.resolve(this.senderName);
  }
}

const request: GenerateCardRequest = {
  recipientUserId: 'partner',
  occasion: 'Anniversary',
  tone: 'AFFECTIONATE',
  locale: 'en',
  memoryIds: ['11111111-1111-4111-8111-111111111111'],
};
const service = (
  repository: FakeRepository,
  generator: CardGenerator = { generate: () => Promise.resolve(generated) },
) =>
  new CardService(
    repository,
    generator,
    {
      next: () =>
        repository.card === null
          ? '22222222-2222-4222-8222-222222222222'
          : '33333333-3333-4333-8333-333333333333',
    },
    { now: () => '2026-09-21T12:00:00.000Z' },
  );

describe('CardService', () => {
  it('generates only from selected memories and validates citations', async () => {
    const repository = new FakeRepository();
    await expect(service(repository).generate('couple', 'sender', request)).resolves.toEqual(
      generated,
    );
    await expect(
      service(repository, {
        generate: () =>
          Promise.resolve({
            ...generated,
            citedMemoryIds: ['44444444-4444-4444-8444-444444444444'],
          }),
      }).generate('couple', 'sender', request),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
  });

  it('supports generic drafts and rejects missing, excessive, or ungrounded context', async () => {
    const repository = new FakeRepository();
    await expect(
      service(repository, {
        generate: () =>
          Promise.resolve({ title: 'Hello', body: 'Thinking of you.', citedMemoryIds: [] }),
      }).generate('couple', 'sender', { ...request, memoryIds: [] }),
    ).resolves.toMatchObject({ citedMemoryIds: [] });
    await expect(
      service(repository, {
        generate: () =>
          Promise.resolve({
            title: 'Hello',
            body: 'Thinking of you.',
            citedMemoryIds: request.memoryIds,
          }),
      }).generate('couple', 'sender', { ...request, memoryIds: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
    await expect(
      service(repository, {
        generate: () => Promise.resolve({ ...generated, citedMemoryIds: [] }),
      }).generate('couple', 'sender', request),
    ).rejects.toMatchObject({ code: 'UNGROUNDED_DRAFT' });
    repository.omitMemory = true;
    await expect(service(repository).generate('couple', 'sender', request)).rejects.toBeTruthy();
    repository.omitMemory = false;
    repository.memories = (_couple, ids) =>
      Promise.resolve(
        ids.map((memoryId) => ({
          memoryId,
          title: 'Large',
          body: 'x'.repeat(40_001),
          occurredOn: '2025-01-01',
        })),
      );
    await expect(service(repository).generate('couple', 'sender', request)).rejects.toMatchObject({
      code: 'CONTEXT_TOO_LARGE',
    });
  });

  it('saves, edits, and deletes only mutable versions', async () => {
    const repository = new FakeRepository();
    const cards = service(repository);
    const saved = await cards.save('couple', 'sender', {
      ...request,
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ...generated,
    });
    expect(saved.status).toBe('DRAFT');
    const edited = await cards.update('couple', 'sender', saved.cardId, {
      ...request,
      version: 1,
      title: 'Edited',
      body: generated.body,
      citedMemoryIds: generated.citedMemoryIds,
    });
    expect(edited).toMatchObject({ title: 'Edited', version: 2 });
    await cards.delete('couple', 'sender', saved.cardId, 2);
    expect(repository.card).toBeNull();
  });

  it('locks the approved version and makes identical send retries idempotent', async () => {
    const repository = new FakeRepository();
    const cards = service(repository);
    const saved = await cards.save('couple', 'sender', {
      ...request,
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ...generated,
    });
    const send = {
      confirmed: true as const,
      version: saved.version,
      idempotencyKey: 'retry-key-123456789',
      deliveryAt: '2026-09-22T12:00:00.000Z',
    };
    const accepted = await cards.send('couple', 'sender', saved.cardId, send);
    expect(accepted.status).toBe('SCHEDULED');
    await expect(cards.send('couple', 'sender', saved.cardId, send)).resolves.toEqual(accepted);
    await expect(
      cards.update('couple', 'sender', saved.cardId, {
        ...request,
        version: 2,
        title: 'Too late',
        body: generated.body,
        citedMemoryIds: generated.citedMemoryIds,
      }),
    ).rejects.toBeTruthy();
  });

  it('rejects changed save retries, missing recipients, and inaccessible cards', async () => {
    const repository = new FakeRepository();
    const cards = service(repository);
    const saveRequest = {
      ...request,
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ...generated,
    };
    await cards.save('couple', 'sender', saveRequest);
    repository.requestReplay = true;
    await expect(cards.save('couple', 'sender', saveRequest)).resolves.toMatchObject({
      title: generated.title,
    });
    await expect(
      cards.save('couple', 'sender', { ...saveRequest, title: 'Changed' }),
    ).rejects.toBeTruthy();
    repository.availableRecipients = [];
    await expect(cards.generate('couple', 'sender', request)).rejects.toBeTruthy();
    repository.card = null;
    await expect(cards.get('couple', 'sender', 'missing')).rejects.toBeTruthy();
  });

  it('covers pagination, stale mutations, and send failure boundaries', async () => {
    const repository = new FakeRepository();
    const cards = service(repository);
    const saved = await cards.save('couple', 'sender', {
      ...request,
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ...generated,
    });
    repository.nextCursor = 'next';
    await expect(cards.list('couple', 'sender')).resolves.toMatchObject({ nextCursor: 'next' });
    await expect(
      cards.update('couple', 'sender', saved.cardId, { ...request, version: 9, ...generated }),
    ).rejects.toBeTruthy();
    await expect(cards.delete('couple', 'sender', saved.cardId, 9)).rejects.toBeTruthy();
    await expect(
      cards.send('couple', 'sender', saved.cardId, {
        confirmed: true,
        version: 1,
        idempotencyKey: 'past-delivery-1234',
        deliveryAt: '2026-09-20T12:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DELIVERY_TIME' });
    repository.senderName = null;
    await expect(
      cards.send('couple', 'sender', saved.cardId, {
        confirmed: true,
        version: 1,
        idempotencyKey: 'missing-sender-123',
      }),
    ).rejects.toBeTruthy();
    repository.senderName = 'Alex';
    repository.send = {
      fingerprint: 'different',
      response: {
        deliveryId: '33333333-3333-4333-8333-333333333333',
        cardId: saved.cardId,
        status: 'QUEUED',
        deliveryAt: saved.updatedAt,
      },
    };
    await expect(
      cards.send('couple', 'sender', saved.cardId, {
        confirmed: true,
        version: 1,
        idempotencyKey: 'changed-payload-12',
      }),
    ).rejects.toBeTruthy();
  });
});
