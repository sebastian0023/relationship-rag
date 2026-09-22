import { ConflictError, ResourceNotFoundError } from '@relationship-rag/domain';
import type { DeliveryRecord, InboxItem } from '@relationship-rag/contracts';

export interface DeliveryRepository {
  get(coupleId: string, deliveryId: string): Promise<DeliveryRecord | null>;
  recipientActive(coupleId: string, recipientUserId: string): Promise<boolean>;
  deliver(record: DeliveryRecord, deliveredAt: string): Promise<'DELIVERED' | 'ALREADY_DELIVERED'>;
  listInbox(
    recipientUserId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ readonly items: readonly InboxItem[]; readonly nextCursor?: string }>;
  getInbox(recipientUserId: string, cardId: string): Promise<InboxItem | null>;
  markRead(recipientUserId: string, cardId: string, readAt: string): Promise<InboxItem>;
  dueWork(coupleId: string, now: string, limit: number): Promise<readonly DeliveryRecord[]>;
  dispatched(record: DeliveryRecord): Promise<void>;
  retry(record: DeliveryRecord, nextAttemptAt: string): Promise<void>;
  fail(coupleId: string, deliveryId: string, failureCode: string): Promise<void>;
}

export interface Dispatcher {
  dispatch(deliveryId: string, coupleId: string, deliveryAt: string, now: string): Promise<void>;
}

export class DeliveryService {
  public constructor(
    private readonly repository: DeliveryRepository,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  public async deliver(
    coupleId: string,
    deliveryId: string,
  ): Promise<'DELIVERED' | 'ALREADY_DELIVERED'> {
    const record = await this.repository.get(coupleId, deliveryId);
    if (record === null) throw new ResourceNotFoundError();
    if (record.status === 'DELIVERED') return 'ALREADY_DELIVERED';
    const now = this.now();
    if (Date.parse(record.deliveryAt) > Date.parse(now)) throw new ConflictError();
    if (!(await this.repository.recipientActive(coupleId, record.recipientUserId)))
      throw new ResourceNotFoundError();
    return this.repository.deliver(record, now);
  }
  public listInbox(userId: string, cursor?: string, limit?: number) {
    return this.repository.listInbox(userId, cursor, limit);
  }
  public async getInbox(userId: string, cardId: string) {
    const item = await this.repository.getInbox(userId, cardId);
    if (item === null) throw new ResourceNotFoundError();
    return item;
  }
  public async markRead(userId: string, cardId: string) {
    await this.getInbox(userId, cardId);
    return this.repository.markRead(userId, cardId, this.now());
  }
}

export class DispatchCoordinator {
  public constructor(
    private readonly coupleId: string,
    private readonly repository: DeliveryRepository,
    private readonly dispatcher: Dispatcher,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  public async run(): Promise<void> {
    const now = this.now();
    for (const work of await this.repository.dueWork(this.coupleId, now, 25)) {
      try {
        await this.dispatcher.dispatch(work.deliveryId, work.coupleId, work.deliveryAt, now);
        await this.repository.dispatched(work);
      } catch {
        const attempts = work.attempts + 1;
        if (attempts >= 5)
          await this.repository.fail(work.coupleId, work.deliveryId, 'DISPATCH_EXHAUSTED');
        else
          await this.repository.retry(
            work,
            new Date(Date.parse(now) + Math.min(300, 2 ** attempts * 5) * 1000).toISOString(),
          );
      }
    }
  }
}
