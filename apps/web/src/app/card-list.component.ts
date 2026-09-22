import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CardDto } from '@relationship-rag/contracts';
import { CardsApiService } from './cards-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: ` <section class="mx-auto max-w-5xl py-12">
    <div class="flex items-end justify-between">
      <div>
        <p class="text-sm uppercase tracking-[.2em] text-rose">Made with care</p>
        <h1 class="mt-2 font-display text-5xl">Card studio</h1>
      </div>
      <a routerLink="new" class="rounded-full bg-rose px-5 py-3 font-semibold text-ink"
        >Create a card</a
      >
    </div>
    @if (error()) {
      <p class="mt-8 rounded-xl bg-wine/30 p-4" role="alert">{{ error() }}</p>
    }
    @if (!loading() && cards().length === 0) {
      <p class="mt-16 text-center text-cream/60">
        Your saved drafts and sent cards will appear here.
      </p>
    }
    <div class="mt-10 grid gap-5 md:grid-cols-2">
      @for (card of cards(); track card.cardId) {
        <a
          [routerLink]="card.cardId"
          class="rounded-3xl border border-white/10 bg-white/5 p-6 hover:bg-white/10"
        >
          <div class="flex justify-between gap-4">
            <span class="text-xs uppercase tracking-wider text-rose">{{ card.status }}</span
            ><span class="text-sm text-cream/50">For {{ card.recipientDisplayName }}</span>
          </div>
          <h2 class="mt-4 font-display text-3xl">{{ card.title }}</h2>
          <p class="mt-3 line-clamp-3 whitespace-pre-line text-cream/70">{{ card.body }}</p>
          @if (card.deliveryAt) {
            <p class="mt-4 text-xs text-cream/50">Delivery: {{ card.deliveryAt }}</p>
          }
        </a>
      }
    </div>
  </section>`,
})
export class CardListComponent {
  private readonly api = inject(CardsApiService);
  protected readonly cards = signal<readonly CardDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  public constructor() {
    void this.load();
  }
  private async load() {
    try {
      this.cards.set((await this.api.list()).items);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load cards.');
    } finally {
      this.loading.set(false);
    }
  }
}
