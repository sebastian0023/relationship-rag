import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MemoryDto } from '@relationship-rag/contracts';
import { MemoriesApiService } from './memories-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: ` <section class="mx-auto max-w-4xl py-12">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm uppercase tracking-[.2em] text-rose">Our shared archive</p>
        <h1 class="mt-2 font-display text-5xl">The timeline</h1>
      </div>
      <a routerLink="new" class="rounded-full bg-rose px-5 py-3 text-sm font-semibold text-ink"
        >Add a memory</a
      >
    </div>
    @if (error()) {
      <p class="mt-8 rounded-xl bg-wine/30 p-4" role="alert">{{ error() }}</p>
    }
    @if (items().length === 0 && !loading()) {
      <p class="mt-16 text-center text-cream/65">Your story starts with one memory.</p>
    }
    <ol class="mt-10 space-y-5">
      @for (memory of items(); track memory.memoryId) {
        <li>
          <a
            [routerLink]="memory.memoryId"
            class="block rounded-3xl border border-white/10 bg-white/5 p-6 transition hover:bg-white/10"
            ><p class="text-sm text-rose">
              {{ memory.occurredOn }}
              @if (memory.location) {
                · {{ memory.location }}
              }
            </p>
            <h2 class="mt-2 font-display text-3xl">{{ memory.title }}</h2>
            <p class="mt-2 text-xs text-cream/55">Index: {{ memory.ingestionStatus }}</p>
            <p class="mt-3 line-clamp-2 text-cream/65">{{ memory.body }}</p>
            <div class="mt-4 flex flex-wrap gap-2">
              @for (tag of memory.tags; track tag) {
                <span class="rounded-full bg-white/10 px-3 py-1 text-xs">{{ tag }}</span>
              }
            </div></a
          >
        </li>
      }
    </ol>
    @if (nextCursor()) {
      <button class="mt-8 rounded-full border border-white/20 px-5 py-3" (click)="loadMore()">
        Load earlier memories
      </button>
    }
  </section>`,
})
export class TimelineComponent {
  private readonly api = inject(MemoriesApiService);
  protected readonly items = signal<readonly MemoryDto[]>([]);
  protected readonly nextCursor = signal<string | undefined>(undefined);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);
  public constructor() {
    void this.load();
  }
  protected async loadMore() {
    await this.load(this.nextCursor());
  }
  private async load(cursor?: string) {
    try {
      this.loading.set(true);
      const page = await this.api.timeline(cursor);
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to load the timeline.');
    } finally {
      this.loading.set(false);
    }
  }
}
