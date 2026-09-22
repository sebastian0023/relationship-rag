import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { InboxItem } from '@relationship-rag/contracts';
import { CardsApiService } from './cards-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: ` <section class="mx-auto max-w-4xl py-12">
    <p class="text-sm uppercase tracking-[.2em] text-rose">Just for you</p>
    <h1 class="mt-2 font-display text-5xl">Inbox</h1>
    @if (error()) {
      <p class="mt-8 rounded-xl bg-wine/30 p-4">{{ error() }}</p>
    }
    @if (!loading() && items().length === 0) {
      <p class="mt-16 text-center text-cream/60">Delivered cards will appear here.</p>
    }
    <div class="mt-10 space-y-4">
      @for (item of items(); track item.cardId) {
        <a
          [routerLink]="item.cardId"
          class="flex items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 hover:bg-white/10"
        >
          @if (!item.readAt) {
            <span class="h-2.5 w-2.5 rounded-full bg-rose" aria-label="Unread"></span>
          }
          <div class="min-w-0 flex-1">
            <p class="text-sm text-rose">From {{ item.senderDisplayName }}</p>
            <h2 class="mt-1 truncate font-display text-2xl">{{ item.title }}</h2>
          </div>
          <time class="text-xs text-cream/50">{{ item.deliveredAt }}</time></a
        >
      }
    </div>
  </section>`,
})
export class InboxComponent {
  private readonly api = inject(CardsApiService);
  protected readonly items = signal<readonly InboxItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  public constructor() {
    void this.load();
  }
  private async load() {
    try {
      this.items.set((await this.api.inbox()).items);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load your inbox.');
    } finally {
      this.loading.set(false);
    }
  }
}
