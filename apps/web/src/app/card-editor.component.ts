import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  CardDto,
  CardRecipient,
  GeneratedCardDraft,
  MemoryDto,
} from '@relationship-rag/contracts';
import { CardsApiService } from './cards-api.service.js';
import { MemoriesApiService } from './memories-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: ` <section class="mx-auto max-w-6xl py-12">
    <a routerLink="/app/cards" class="text-sm text-rose">← Card studio</a>
    <div class="mt-6 grid gap-8 lg:grid-cols-[1fr_.9fr]">
      <form class="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-7" (ngSubmit)="save()">
        <h1 class="font-display text-4xl">{{ saved() ? 'Edit card' : 'Create a card' }}</h1>
        @if (error()) {
          <p class="rounded-xl bg-wine/35 p-4">{{ error() }}</p>
        }
        <label class="block text-sm"
          >Recipient<select
            name="recipient"
            [(ngModel)]="recipientUserId"
            [disabled]="saved() !== null"
            class="mt-2 w-full rounded-xl bg-ink p-3 ring-1 ring-white/15"
          >
            <option value="">Choose your partner</option>
            @for (recipient of recipients(); track recipient.userId) {
              <option [value]="recipient.userId">{{ recipient.displayName }}</option>
            }
          </select></label
        >
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="text-sm"
            >Occasion<input
              name="occasion"
              [(ngModel)]="occasion"
              maxlength="120"
              class="mt-2 w-full rounded-xl bg-ink p-3 ring-1 ring-white/15" /></label
          ><label class="text-sm"
            >Tone<select
              name="tone"
              [(ngModel)]="tone"
              class="mt-2 w-full rounded-xl bg-ink p-3 ring-1 ring-white/15"
            >
              <option value="AFFECTIONATE">Affectionate</option>
              <option value="PLAYFUL">Playful</option>
              <option value="GRATEFUL">Grateful</option>
              <option value="REFLECTIVE">Reflective</option>
            </select></label
          >
        </div>
        <label class="block text-sm"
          >Language<select
            name="locale"
            [(ngModel)]="locale"
            class="mt-2 w-full rounded-xl bg-ink p-3 ring-1 ring-white/15"
          >
            <option value="en">English</option>
            <option value="es">Español</option>
          </select></label
        >
        <fieldset>
          <legend class="text-sm">Selected memories (optional)</legend>
          <div class="mt-2 max-h-48 space-y-2 overflow-auto rounded-xl bg-ink/50 p-3">
            @for (memory of memories(); track memory.memoryId) {
              <label class="flex gap-3 text-sm"
                ><input
                  type="checkbox"
                  [checked]="selectedIds().includes(memory.memoryId)"
                  (change)="toggleMemory(memory.memoryId)"
                />
                <span>{{ memory.occurredOn }} · {{ memory.title }}</span></label
              >
            }
          </div>
        </fieldset>
        <button
          type="button"
          [disabled]="busy()"
          (click)="generate()"
          class="rounded-full border border-rose px-5 py-3 text-rose"
        >
          {{ saved() ? 'Regenerate suggestion' : 'Generate suggestion' }}
        </button>
        @if (proposal(); as suggestion) {
          <div class="rounded-2xl border border-rose/40 bg-rose/10 p-5">
            <p class="text-xs uppercase tracking-wider text-rose">New suggestion</p>
            <h3 class="mt-2 font-display text-2xl">{{ suggestion.title }}</h3>
            <p class="mt-2 whitespace-pre-line text-cream/70">{{ suggestion.body }}</p>
            <div class="mt-4 flex gap-3">
              <button
                type="button"
                (click)="acceptProposal()"
                class="rounded-full bg-rose px-4 py-2 text-sm text-ink"
              >
                Use this draft</button
              ><button type="button" (click)="proposal.set(null)" class="text-sm">Reject</button>
            </div>
          </div>
        }
        <label class="block text-sm"
          >Title<input
            name="title"
            [(ngModel)]="title"
            maxlength="120"
            class="mt-2 w-full rounded-xl bg-ink p-3 ring-1 ring-white/15"
        /></label>
        <label class="block text-sm"
          >Message<textarea
            name="body"
            [(ngModel)]="body"
            rows="10"
            maxlength="10000"
            class="mt-2 w-full rounded-xl bg-ink p-3 ring-1 ring-white/15"
          ></textarea>
        </label>
        <div class="flex flex-wrap gap-3">
          <button
            [disabled]="busy() || !editable()"
            class="rounded-full bg-rose px-5 py-3 font-semibold text-ink"
          >
            Save draft
          </button>
          @if (saved()?.status === 'DRAFT') {
            <button
              type="button"
              (click)="showConfirmation.set(true)"
              class="rounded-full border border-white/20 px-5 py-3"
            >
              Preview & send</button
            ><button type="button" (click)="remove()" class="px-4 py-3 text-sm text-rose">
              Delete draft
            </button>
          }
        </div>
      </form>
      <aside class="rounded-3xl bg-paper p-8 text-ink lg:sticky lg:top-8 lg:self-start">
        <p class="text-xs uppercase tracking-[.2em] text-wine">Preview</p>
        <h2 class="mt-8 font-display text-4xl">{{ title || 'Your title' }}</h2>
        <p class="mt-6 whitespace-pre-line leading-7">
          {{ body || 'Your message will appear here.' }}
        </p>
        @if (citedIds().length) {
          <div class="mt-8 border-t border-ink/15 pt-5">
            <p class="text-xs uppercase tracking-wider">Supporting memories</p>
            @for (id of citedIds(); track id) {
              <a [routerLink]="['/app/timeline', id]" class="mt-2 block text-sm underline">{{
                memoryTitle(id)
              }}</a>
            }
          </div>
        }
      </aside>
    </div>
    @if (showConfirmation() && saved(); as card) {
      <div class="fixed inset-0 z-10 grid place-items-center bg-ink/85 p-5">
        <section
          class="max-h-[90vh] w-full max-w-xl overflow-auto rounded-3xl bg-paper p-8 text-ink"
        >
          <h2 class="font-display text-4xl">Confirm delivery</h2>
          <p class="mt-3 text-sm">
            To {{ card.recipientDisplayName }}. Sending locks this saved version.
          </p>
          <h3 class="mt-6 font-display text-2xl">{{ card.title }}</h3>
          <p class="mt-3 whitespace-pre-line">{{ card.body }}</p>
          <label class="mt-6 block text-sm"
            >Schedule for later (optional)<input
              type="datetime-local"
              [(ngModel)]="scheduleAt"
              class="mt-2 w-full rounded-xl border border-ink/20 bg-white p-3"
          /></label>
          <p class="mt-2 text-xs">
            Times use {{ timeZone }}. Scheduled cards arrive at or after the selected minute.
          </p>
          <div class="mt-6 flex gap-3">
            <button
              [disabled]="busy()"
              (click)="send()"
              class="rounded-full bg-wine px-5 py-3 text-cream"
            >
              Confirm send</button
            ><button (click)="showConfirmation.set(false)" class="px-5 py-3">Cancel</button>
          </div>
        </section>
      </div>
    }
  </section>`,
})
export class CardEditorComponent {
  private readonly api = inject(CardsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly recipients = signal<readonly CardRecipient[]>([]);
  protected readonly memories = signal<readonly MemoryDto[]>([]);
  protected readonly selectedIds = signal<string[]>([]);
  protected readonly citedIds = signal<string[]>([]);
  protected readonly saved = signal<CardDto | null>(null);
  protected readonly proposal = signal<GeneratedCardDraft | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly showConfirmation = signal(false);
  protected recipientUserId = '';
  protected occasion = '';
  protected tone: CardDto['tone'] = 'AFFECTIONATE';
  protected locale: CardDto['locale'] = 'en';
  protected title = '';
  protected body = '';
  protected scheduleAt = '';
  protected readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  public constructor() {
    void this.load();
  }
  protected editable() {
    return this.saved()?.status === undefined || this.saved()?.status === 'DRAFT';
  }
  protected toggleMemory(id: string) {
    this.selectedIds.update((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 20 ? [...ids, id] : ids,
    );
  }
  protected memoryTitle(id: string) {
    return this.memories().find((memory) => memory.memoryId === id)?.title ?? id;
  }
  protected async generate() {
    await this.run(async () => {
      this.proposal.set(await this.api.generate(this.generationRequest()));
    });
  }
  protected acceptProposal() {
    const proposal = this.proposal();
    if (proposal === null) return;
    this.title = proposal.title;
    this.body = proposal.body;
    this.citedIds.set([...proposal.citedMemoryIds]);
    this.proposal.set(null);
  }
  protected async save() {
    await this.run(async () => {
      const current = this.saved();
      const common = {
        ...this.generationRequest(),
        title: this.title,
        body: this.body,
        citedMemoryIds: this.citedIds(),
      };
      const saved =
        current === null
          ? await this.api.create({ ...common, clientRequestId: crypto.randomUUID() })
          : await this.api.update(current.cardId, { ...common, version: current.version });
      this.saved.set(saved);
      if (current === null)
        await this.router.navigate(['/app/cards', saved.cardId], { replaceUrl: true });
    });
  }
  protected async remove() {
    const card = this.saved();
    if (card === null || !confirm('Delete this draft?')) return;
    await this.run(async () => {
      await this.api.delete(card.cardId, card.version);
      await this.router.navigateByUrl('/app/cards');
    });
  }
  protected async send() {
    const card = this.saved();
    if (card === null) return;
    await this.run(async () => {
      const deliveryAt = this.scheduleAt === '' ? undefined : this.scheduleIso();
      await this.api.send(card.cardId, {
        confirmed: true,
        version: card.version,
        idempotencyKey: crypto.randomUUID(),
        ...(deliveryAt === undefined ? {} : { deliveryAt }),
      });
      this.showConfirmation.set(false);
      this.saved.set(await this.api.get(card.cardId));
    });
  }
  private generationRequest() {
    return {
      recipientUserId: this.recipientUserId,
      occasion: this.occasion,
      tone: this.tone,
      locale: this.locale,
      memoryIds: this.selectedIds(),
    };
  }
  private scheduleIso(): string {
    const parsed = new Date(this.scheduleAt);
    const requestedMinute = this.scheduleAt.slice(0, 16);
    const localMinute = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    if (!Number.isFinite(parsed.getTime()) || localMinute(parsed) !== requestedMinute) {
      throw new Error('Choose a valid local delivery time.');
    }
    if (
      localMinute(new Date(parsed.getTime() - 3_600_000)) === requestedMinute ||
      localMinute(new Date(parsed.getTime() + 3_600_000)) === requestedMinute
    ) {
      throw new Error(
        'That local time is ambiguous because of daylight saving time. Choose another time.',
      );
    }
    return parsed.toISOString();
  }
  private async load() {
    await this.run(async () => {
      const [recipients, timeline] = await Promise.all([
        this.api.recipients(),
        this.memoriesApi.timeline(),
      ]);
      this.recipients.set(recipients);
      this.memories.set(timeline.items);
      const cardId = this.route.snapshot.paramMap.get('cardId');
      if (cardId !== null) {
        const card = await this.api.get(cardId);
        this.saved.set(card);
        this.recipientUserId = card.recipientUserId;
        this.occasion = card.occasion;
        this.tone = card.tone;
        this.locale = card.locale;
        this.selectedIds.set([...card.memoryIds]);
        this.citedIds.set([...card.citedMemoryIds]);
        this.title = card.title;
        this.body = card.body;
      } else if (recipients[0] !== undefined) this.recipientUserId = recipients[0].userId;
    });
  }
  private async run(action: () => Promise<void>) {
    try {
      this.busy.set(true);
      this.error.set(null);
      await action();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to complete this action.');
    } finally {
      this.busy.set(false);
    }
  }
}
