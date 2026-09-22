import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { InboxItem } from '@relationship-rag/contracts';
import { CardsApiService } from './cards-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: ` <section class="mx-auto max-w-3xl py-12">
    <a routerLink="/app/inbox" class="text-sm text-rose">← Inbox</a>
    @if (error()) {
      <p class="mt-8 rounded-xl bg-wine/30 p-4">{{ error() }}</p>
    }
    @if (item(); as card) {
      <article class="mt-8 rounded-3xl bg-paper p-8 text-ink sm:p-12">
        <p class="text-xs uppercase tracking-[.2em] text-wine">From {{ card.senderDisplayName }}</p>
        <h1 class="mt-8 font-display text-5xl">{{ card.title }}</h1>
        <p class="mt-8 whitespace-pre-line text-lg leading-8">{{ card.body }}</p>
        @if (card.citedMemoryIds.length) {
          <div class="mt-10 border-t border-ink/15 pt-5">
            <p class="text-xs uppercase tracking-wider">Memories behind this card</p>
            @for (memoryId of card.citedMemoryIds; track memoryId) {
              <a [routerLink]="['/app/timeline', memoryId]" class="mt-2 block text-sm underline"
                >View memory</a
              >
            }
          </div>
        }
        <p class="mt-10 text-xs text-ink/55">Delivered {{ card.deliveredAt }}</p>
      </article>
    }
  </section>`,
})
export class InboxDetailComponent {
  private readonly api = inject(CardsApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly item = signal<InboxItem | null>(null);
  protected readonly error = signal<string | null>(null);
  public constructor() {
    void this.load();
  }
  private async load() {
    try {
      const cardId = this.route.snapshot.paramMap.get('cardId');
      if (cardId === null) throw new Error('Card not found.');
      const item = await this.api.inboxItem(cardId);
      this.item.set(item);
      if (item.readAt === undefined) this.item.set(await this.api.markRead(cardId));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to open this card.');
    }
  }
}
