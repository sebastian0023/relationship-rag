import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import type { MemoryDto } from '@relationship-rag/contracts';
import { MemoriesApiService } from './memories-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: ` <section class="mx-auto max-w-2xl py-12">
    <p class="text-sm uppercase tracking-[.2em] text-rose">Shared memory</p>
    <h1 class="mt-2 font-display text-5xl">
      {{ memoryId === null ? 'Add a memory' : 'Edit memory' }}
    </h1>
    @if (error()) {
      <p class="mt-6 rounded-xl bg-wine/30 p-4">{{ error() }}</p>
    }
    <form class="mt-8 space-y-5" (ngSubmit)="save()">
      <label class="block"
        >Title<input
          class="mt-2 w-full rounded-xl bg-white/10 p-3"
          name="title"
          [(ngModel)]="draft.title"
          required
          maxlength="120" /></label
      ><label class="block"
        >Date<input
          class="mt-2 w-full rounded-xl bg-white/10 p-3"
          name="occurredOn"
          [(ngModel)]="draft.occurredOn"
          type="date"
          required /></label
      ><label class="block"
        >Location
        <input
          class="mt-2 w-full rounded-xl bg-white/10 p-3"
          name="location"
          [(ngModel)]="draft.location"
          maxlength="200" /></label
      ><label class="block"
        >Memory<textarea
          class="mt-2 min-h-44 w-full rounded-xl bg-white/10 p-3"
          name="body"
          [(ngModel)]="draft.body"
          required
          maxlength="10000"
        ></textarea></label
      ><label class="block"
        >Tags, separated by commas<input
          class="mt-2 w-full rounded-xl bg-white/10 p-3"
          name="tags"
          [(ngModel)]="draft.tags" /></label
      ><label class="block"
        >Category<input
          class="mt-2 w-full rounded-xl bg-white/10 p-3"
          name="category"
          [(ngModel)]="draft.category"
          maxlength="40" /></label
      ><label class="block"
        >Language<select
          class="mt-2 w-full rounded-xl bg-white/10 p-3"
          name="locale"
          [(ngModel)]="draft.locale"
        >
          <option value="en">English</option>
          <option value="es">Español</option>
        </select></label
      ><button class="rounded-full bg-rose px-5 py-3 font-semibold text-ink" [disabled]="saving()">
        {{ saving() ? 'Saving…' : 'Save memory' }}
      </button>
    </form>
  </section>`,
})
export class MemoryEditorComponent {
  private readonly api = inject(MemoriesApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly memoryId = this.route.snapshot.paramMap.get('memoryId');
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  private version = 1;
  protected draft = {
    title: '',
    occurredOn: new Date().toISOString().slice(0, 10),
    body: '',
    locale: 'en' as 'en' | 'es',
    tags: '',
    category: '',
    location: '',
  };
  public constructor() {
    if (this.memoryId !== null) void this.load();
  }
  private async load() {
    try {
      const m = await this.api.get(this.memoryId!);
      this.assign(m);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to load this memory.');
    }
  }
  private assign(m: MemoryDto) {
    this.version = m.version;
    this.draft = {
      title: m.title,
      occurredOn: m.occurredOn,
      body: m.body,
      locale: m.locale,
      tags: m.tags.join(', '),
      category: m.category ?? '',
      location: m.location ?? '',
    };
  }
  protected async save() {
    this.saving.set(true);
    this.error.set(null);
    const request = {
      title: this.draft.title,
      occurredOn: this.draft.occurredOn,
      body: this.draft.body,
      locale: this.draft.locale,
      tags: this.draft.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(this.draft.location.trim() === '' ? {} : { location: this.draft.location.trim() }),
      ...(this.draft.category.trim() === '' ? {} : { category: this.draft.category.trim() }),
    };
    try {
      const result =
        this.memoryId === null
          ? await this.api.create(request)
          : await this.api.update(this.memoryId, { ...request, version: this.version });
      await this.router.navigate(['/app/timeline', result.memoryId]);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Unable to save this memory.');
    } finally {
      this.saving.set(false);
    }
  }
}
