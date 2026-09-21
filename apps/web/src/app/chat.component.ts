import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Conversation, ConversationSummary } from '@relationship-rag/contracts';
import { ChatApiService } from './chat-api.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `<section class="mx-auto grid max-w-6xl gap-8 py-10 lg:grid-cols-[15rem_1fr]">
    <aside class="rounded-3xl border border-white/10 bg-white/5 p-4">
      <button
        class="w-full rounded-full bg-rose px-4 py-2 text-sm font-semibold text-ink"
        (click)="newConversation()"
      >
        New chat
      </button>
      <p class="mt-5 text-xs uppercase tracking-[.18em] text-cream/50">Your conversations</p>
      <ol class="mt-3 space-y-1">
        @for (item of conversations(); track item.conversationId) {
          <li>
            <a
              class="block rounded-xl px-3 py-2 text-sm hover:bg-white/10"
              [routerLink]="['/app/chat', item.conversationId]"
              >{{ item.title }}</a
            >
          </li>
        }
      </ol>
    </aside>
    <main>
      <p class="text-sm uppercase tracking-[.2em] text-rose">Shared-memory assistant</p>
      <h1 class="mt-2 font-display text-5xl">Ask about your story</h1>
      @if (error()) {
        <p class="mt-6 rounded-xl bg-wine/30 p-4" role="alert">{{ error() }}</p>
      }
      @if (conversation()?.turns?.length === 0 && !loading()) {
        <p class="mt-12 text-cream/65">Ask about a memory you have saved and indexed.</p>
      }
      <ol class="mt-8 space-y-5" aria-live="polite">
        @for (turn of conversation()?.turns ?? []; track turn.turnId) {
          <li class="space-y-3">
            <article class="ml-auto max-w-xl rounded-3xl bg-rose px-5 py-4 text-ink">
              <p class="whitespace-pre-wrap">{{ turn.question }}</p>
            </article>
            @if (turn.status === 'COMPLETED') {
              <article class="max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-5">
                <p class="whitespace-pre-wrap">{{ turn.answer }}</p>
                @if (turn.abstained) {
                  <p class="mt-3 text-sm text-cream/60">No supporting shared memory was found.</p>
                }
                @if (turn.citations?.length) {
                  <div class="mt-4 flex flex-wrap gap-2">
                    @for (citation of turn.citations; track citation.memoryId) {
                      <a
                        class="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20"
                        [routerLink]="['/app/timeline', citation.memoryId]"
                        >{{ citation.title }}</a
                      >
                    }
                  </div>
                }
              </article>
            }
          </li>
        }
      </ol>
      <form class="mt-8 rounded-3xl border border-white/10 bg-white/5 p-5" (ngSubmit)="send()">
        <label class="block text-sm" for="question">Your question</label>
        <textarea
          id="question"
          class="mt-2 min-h-28 w-full rounded-2xl bg-ink p-4 text-cream"
          name="question"
          [(ngModel)]="question"
          maxlength="2000"
          required
          [disabled]="sending()"
        ></textarea>
        <details class="mt-4 text-sm text-cream/70">
          <summary class="cursor-pointer">Filter memories</summary>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label
              >From
              <input
                class="mt-1 block w-full rounded-lg bg-ink p-2"
                type="date"
                name="from"
                [(ngModel)]="from" /></label
            ><label
              >To
              <input
                class="mt-1 block w-full rounded-lg bg-ink p-2"
                type="date"
                name="to"
                [(ngModel)]="to" /></label
            ><label
              >Category
              <input
                class="mt-1 block w-full rounded-lg bg-ink p-2"
                name="category"
                [(ngModel)]="category" /></label
            ><label
              >Tags
              <input
                class="mt-1 block w-full rounded-lg bg-ink p-2"
                name="tags"
                [(ngModel)]="tags"
                placeholder="comma-separated"
            /></label>
          </div>
        </details>
        <div class="mt-5 flex items-center gap-4">
          <button
            class="rounded-full bg-rose px-5 py-3 text-sm font-semibold text-ink disabled:opacity-60"
            [disabled]="sending() || !question.trim()"
          >
            {{ sending() ? 'Searching memories…' : 'Ask' }}
          </button>
          @if (retryRequestId()) {
            <span class="text-sm text-cream/65">You can retry this question safely.</span>
          }
        </div>
      </form>
    </main>
  </section>`,
})
export class ChatComponent {
  private readonly api = inject(ChatApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly conversation = signal<Conversation | null>(null);
  protected readonly conversations = signal<readonly ConversationSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly retryRequestId = signal<string | null>(null);
  protected question = '';
  protected from = '';
  protected to = '';
  protected category = '';
  protected tags = '';
  public constructor() {
    void this.loadList();
    this.route.paramMap.subscribe((params) => {
      const id = params.get('conversationId');
      if (id === null) void this.newConversation();
      else void this.load(id);
    });
  }
  protected async newConversation() {
    try {
      const conversation = await this.api.createConversation();
      await this.router.navigate(['/app/chat', conversation.conversationId]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to create a conversation.');
    }
  }
  protected async send() {
    const current = this.conversation();
    if (current === null || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    const requestId = this.retryRequestId() ?? crypto.randomUUID();
    try {
      await this.api.send(current.conversationId, {
        requestId,
        question: this.question.trim(),
        filters: {
          ...(this.from === '' ? {} : { occurredOnFrom: this.from }),
          ...(this.to === '' ? {} : { occurredOnTo: this.to }),
          ...(this.category.trim() === '' ? {} : { category: this.category.trim() }),
          ...(this.tags.trim() === ''
            ? {}
            : {
                tags: this.tags
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              }),
        },
      });
      this.question = '';
      this.retryRequestId.set(null);
      await this.load(current.conversationId);
      await this.loadList();
    } catch (error) {
      this.retryRequestId.set(requestId);
      this.error.set(error instanceof Error ? error.message : 'Unable to answer that question.');
    } finally {
      this.sending.set(false);
    }
  }
  private async load(id: string) {
    try {
      this.loading.set(true);
      this.conversation.set(await this.api.get(id));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load this conversation.');
    } finally {
      this.loading.set(false);
    }
  }
  private async loadList() {
    try {
      this.conversations.set((await this.api.list()).items);
    } catch {
      /* current conversation remains usable */
    }
  }
}
