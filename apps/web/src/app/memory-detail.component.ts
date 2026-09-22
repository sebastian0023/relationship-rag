import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import type { MemoryDto } from '@relationship-rag/contracts';
import { MemoriesApiService } from './memories-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `<section class="mx-auto max-w-3xl py-12">
    @if (memory(); as item) {
      <a routerLink="/app/timeline" class="text-sm text-rose">← Timeline</a>
      <div class="mt-6 flex items-start justify-between gap-4">
        <div>
          <p class="text-sm text-rose">
            {{ item.occurredOn }}
            @if (item.location) {
              · {{ item.location }}
            }
          </p>
          <h1 class="mt-2 font-display text-5xl">{{ item.title }}</h1>
          <p class="mt-2 text-sm text-cream/60">Index: {{ ingestionStatus() }}</p>
        </div>
        <a [routerLink]="['edit']" class="rounded-full border border-white/20 px-4 py-2">Edit</a>
      </div>
      <p class="mt-8 whitespace-pre-wrap leading-8 text-cream/80">{{ item.body }}</p>
      @if (ingestionStatus() === 'FAILED' || ingestionStatus() === 'NOT_REQUESTED') {
        <button
          class="mt-5 rounded-full border border-white/20 px-4 py-2 text-sm"
          (click)="reindex()"
        >
          {{ ingestionStatus() === 'FAILED' ? 'Retry indexing' : 'Index memory' }}
        </button>
      }
      <label class="mt-8 block rounded-2xl border border-dashed border-white/25 p-5"
        >Add up to 10 photos (JPEG, PNG, WebP; 10 MiB each)<input
          class="mt-3 block"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          (change)="upload($event)"
      /></label>
      <div class="mt-8 grid gap-4 sm:grid-cols-2">
        @for (photo of item.photos; track photo.photoId) {
          <div>
            @if (photo.status === 'READY' && photo.displayUrl) {
              <img [src]="photo.displayUrl" [alt]="item.title" class="rounded-2xl" />
            } @else {
              <p class="rounded-xl bg-white/5 p-4">Photo {{ photo.status.toLowerCase() }}…</p>
            }
            <button class="mt-2 text-sm text-rose" (click)="removePhoto(photo.photoId)">
              Remove photo
            </button>
          </div>
        }
      </div>
      <button class="mt-10 text-sm text-rose" (click)="remove()">Delete this memory</button>
    } @else if (error()) {
      <p role="alert">{{ error() }}</p>
    } @else {
      <p>Loading memory…</p>
    }
  </section>`,
})
export class MemoryDetailComponent implements OnDestroy {
  private readonly api = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly memory = signal<MemoryDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly ingestionStatus = signal('NOT_REQUESTED');
  private poll: ReturnType<typeof setInterval> | undefined;
  private readonly id = this.route.snapshot.paramMap.get('memoryId')!;
  public constructor() {
    void this.load();
  }
  private async load() {
    try {
      this.memory.set(await this.api.get(this.id));
      await this.loadIngestion();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to load this memory.');
    }
  }
  private async loadIngestion() {
    const ingestion = await this.api.ingestion(this.id);
    this.ingestionStatus.set(ingestion.status);
    if (ingestion.status === 'PENDING' && this.poll === undefined)
      this.poll = setInterval(() => void this.loadIngestion(), 5000);
    if (ingestion.status !== 'PENDING' && this.poll !== undefined) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
  }
  protected async reindex() {
    try {
      this.ingestionStatus.set((await this.api.reindex(this.id)).status);
      await this.loadIngestion();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to index this memory.');
    }
  }
  public ngOnDestroy() {
    if (this.poll !== undefined) clearInterval(this.poll);
  }
  protected async upload(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    try {
      await this.api.upload(this.id, file);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to upload this photo.');
    }
  }
  protected async removePhoto(photoId: string) {
    try {
      await this.api.deletePhoto(this.id, photoId);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to remove this photo.');
    }
  }
  protected async remove() {
    if (!confirm('Delete this memory and its photos?')) return;
    try {
      await this.api.delete(this.id);
      await this.router.navigate(['/app/timeline']);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to delete this memory.');
    }
  }
}
