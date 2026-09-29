import { Injectable, inject, signal } from '@angular/core';
import { CardsApiService } from './cards-api.service.js';

/** Unread count for the navigation badge, from the newest inbox page. */
@Injectable({ providedIn: 'root' })
export class InboxState {
  private readonly api = inject(CardsApiService);
  public readonly unread = signal(0);

  public async refresh(): Promise<void> {
    try {
      const page = await this.api.inbox();
      this.unread.set(page.items.filter((item) => item.readAt === undefined).length);
    } catch {
      /* The badge is a convenience; the inbox screen reports its own errors. */
    }
  }

  public markedRead(): void {
    this.unread.update((count) => Math.max(0, count - 1));
  }
}
