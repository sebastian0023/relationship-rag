import { describe, expect, it } from 'vitest';
import type { DeliveryRecord, InboxItem } from '@relationship-rag/contracts';
import { DeliveryService, DispatchCoordinator, type DeliveryRepository } from './delivery.js';

const record: DeliveryRecord = {
  deliveryId: '11111111-1111-4111-8111-111111111111',
  coupleId: 'couple',
  cardId: '22222222-2222-4222-8222-222222222222',
  senderUserId: 'sender',
  senderDisplayName: 'Alex',
  recipientUserId: 'partner',
  cardCreatedAt: '2026-09-20T12:00:00.000Z',
  occasion: 'Anniversary',
  tone: 'AFFECTIONATE',
  locale: 'en',
  title: 'For you',
  body: 'Hello',
  citedMemoryIds: [],
  deliveryAt: '2026-09-21T11:00:00.000Z',
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: '2026-09-21T11:00:00.000Z',
};
class FakeRepository implements DeliveryRepository {
  public current: DeliveryRecord | null = record;
  public deliveries = 0;
  public dispatchedCount = 0;
  public retries = 0;
  public failures = 0;
  public active = true;
  public inbox: InboxItem | null = null;
  public get() {
    return Promise.resolve(this.current);
  }
  public recipientActive() {
    return Promise.resolve(this.active);
  }
  public deliver(value: DeliveryRecord, deliveredAt: string) {
    this.deliveries++;
    this.current = { ...value, status: 'DELIVERED', deliveredAt };
    return Promise.resolve('DELIVERED' as const);
  }
  public listInbox(): Promise<{ items: readonly InboxItem[] }> {
    return Promise.resolve({ items: this.inbox === null ? [] : [this.inbox] });
  }
  public getInbox(): Promise<InboxItem | null> {
    return Promise.resolve(this.inbox);
  }
  public markRead(_user: string, _card: string, readAt: string): Promise<InboxItem> {
    if (this.inbox === null) throw new Error('missing');
    this.inbox = { ...this.inbox, readAt };
    return Promise.resolve(this.inbox);
  }
  public dueWork() {
    return Promise.resolve(this.current === null ? [] : [this.current]);
  }
  public dispatched() {
    this.dispatchedCount++;
    return Promise.resolve();
  }
  public retry() {
    this.retries++;
    return Promise.resolve();
  }
  public fail() {
    this.failures++;
    return Promise.resolve();
  }
}
describe('delivery', () => {
  it('delivers a due approved snapshot and treats completed work as idempotent', async () => {
    const repository = new FakeRepository();
    const service = new DeliveryService(repository, () => '2026-09-21T12:00:00.000Z');
    await expect(service.deliver('couple', record.deliveryId)).resolves.toBe('DELIVERED');
    await expect(service.deliver('couple', record.deliveryId)).resolves.toBe('ALREADY_DELIVERED');
    expect(repository.deliveries).toBe(1);
  });
  it('refuses an early delivery', async () => {
    const repository = new FakeRepository();
    const service = new DeliveryService(repository, () => '2026-09-21T10:00:00.000Z');
    await expect(service.deliver('couple', record.deliveryId)).rejects.toBeTruthy();
  });
  it('hides missing work and inactive recipients', async () => {
    const repository = new FakeRepository();
    const service = new DeliveryService(repository, () => '2026-09-21T12:00:00.000Z');
    repository.current = null;
    await expect(service.deliver('couple', record.deliveryId)).rejects.toBeTruthy();
    repository.current = record;
    repository.active = false;
    await expect(service.deliver('couple', record.deliveryId)).rejects.toBeTruthy();
  });
  it('lists, opens, and marks an inbox item read', async () => {
    const repository = new FakeRepository();
    repository.inbox = {
      cardId: record.cardId,
      deliveryId: record.deliveryId,
      senderUserId: 'sender',
      senderDisplayName: 'Alex',
      recipientUserId: 'partner',
      occasion: 'Anniversary',
      tone: 'AFFECTIONATE',
      locale: 'en',
      title: 'Hi',
      body: 'Hello',
      citedMemoryIds: [],
      deliveredAt: '2026-09-21T12:00:00.000Z',
    };
    const service = new DeliveryService(repository, () => '2026-09-21T13:00:00.000Z');
    await expect(service.listInbox('partner')).resolves.toMatchObject({
      items: [repository.inbox],
    });
    await expect(service.getInbox('partner', record.cardId)).resolves.toMatchObject({
      title: 'Hi',
    });
    await expect(service.markRead('partner', record.cardId)).resolves.toMatchObject({
      readAt: '2026-09-21T13:00:00.000Z',
    });
    repository.inbox = null;
    await expect(service.getInbox('partner', record.cardId)).rejects.toBeTruthy();
  });
  it('retries dispatch failures and marks successful dispatch', async () => {
    const repository = new FakeRepository();
    await new DispatchCoordinator(
      'couple',
      repository,
      { dispatch: () => Promise.reject(new Error('down')) },
      () => '2026-09-21T12:00:00.000Z',
    ).run();
    expect(repository.retries).toBe(1);
    await new DispatchCoordinator(
      'couple',
      repository,
      { dispatch: () => Promise.resolve() },
      () => '2026-09-21T12:00:00.000Z',
    ).run();
    expect(repository.dispatchedCount).toBe(1);
  });
  it('archives dispatch work after the retry limit', async () => {
    const repository = new FakeRepository();
    repository.current = { ...record, attempts: 4 };
    await new DispatchCoordinator(
      'couple',
      repository,
      { dispatch: () => Promise.reject(new Error('down')) },
      () => '2026-09-21T12:00:00.000Z',
    ).run();
    expect(repository.failures).toBe(1);
  });
});
