import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  ChatTurn,
  ConversationSummary,
  MemoryDto,
  MemoryRetrievalFilters,
} from '@relationship-rag/contracts';
import { isNotFound, supportReference } from './api/api-error.js';
import { ChatApiService } from './chat-api.service.js';
import {
  QUESTION_MAX,
  conversationTitle,
  filterChips,
  filterOptions,
  noFilters,
  rangeError,
  retrievalFilters,
  type ChatFilters,
} from './chat/filters.js';
import { MemoriesApiService } from './memories-api.service.js';
import { LiveAnnouncer } from './ui/avisos.service.js';
import { counterLabel, formatShortDate, formatShortInstant } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';
import { PanelComponent } from './ui/panel.component.js';

interface ChatEntry {
  readonly requestId: string;
  readonly question: string;
  readonly filters: MemoryRetrievalFilters | undefined;
  readonly status: 'pending' | 'failed' | 'completed';
  readonly answer: string | undefined;
  readonly citations: NonNullable<ChatTurn['citations']>;
  readonly abstained: boolean;
}

const entryFrom = (turn: ChatTurn): ChatEntry => ({
  requestId: turn.requestId,
  question: turn.question,
  filters: turn.filters,
  status:
    turn.status === 'COMPLETED' ? 'completed' : turn.status === 'FAILED' ? 'failed' : 'pending',
  answer: turn.answer,
  citations: turn.citations ?? [],
  abstained: turn.abstained ?? false,
});

const SUGGESTIONS = [
  '¿Qué hicimos en nuestro último viaje?',
  '¿Cómo fue nuestra primera cita?',
  '¿Qué celebramos este año?',
];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent, IconComponent, ListaEstadoComponent, PanelComponent, RouterLink],
  host: { class: 'flex min-h-0 flex-1' },
  template: `
    <aside
      aria-label="Historial de conversaciones"
      class="hidden w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-borde px-3.5 py-[22px] lg:flex"
    >
      <button type="button" class="nh-btn nh-btn-primario min-h-[46px]" (click)="newConversation()">
        <nh-icon name="plus" />Nueva conversación
      </button>
      <h2
        class="mx-1.5 mb-0 mt-2 text-[13px] font-semibold uppercase tracking-[.05em] text-ciruela-suave"
      >
        Tus conversaciones
      </h2>
      @for (item of conversations(); track item.conversationId) {
        <button
          type="button"
          class="flex min-h-[52px] flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left"
          [class]="item.conversationId === conversationId() ? 'bg-rosa-claro' : 'hover:bg-papel'"
          [attr.aria-current]="item.conversationId === conversationId() ? 'true' : null"
          (click)="openConversation(item.conversationId)"
        >
          <span
            class="text-[15px] leading-[1.3]"
            [class]="item.conversationId === conversationId() ? 'font-bold' : 'font-medium'"
            >{{ titleOf(item) }}</span
          >
          <span class="text-[13px] text-ciruela-suave">{{ dateOf(item) }}</span>
        </button>
      }
      <p class="mx-1.5 mb-0 mt-auto text-[12.5px] leading-normal text-ciruela-suave">
        Solo tú ves tus conversaciones. Los recuerdos son de los dos.
      </p>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <div
        class="flex shrink-0 flex-col gap-2 border-b border-[#EFE3D7] bg-[rgba(255,249,242,.96)] px-3 py-2.5"
      >
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="nh-btn nh-btn-secundario min-h-11 gap-1.5 px-3 text-sm lg:hidden"
            aria-haspopup="dialog"
            (click)="panel.set('history')"
          >
            <nh-icon name="history" />Historial
          </button>
          <h1
            class="m-0 min-w-0 flex-1 truncate px-1 font-titulo text-lg font-medium leading-[1.2]"
          >
            {{ title() }}
          </h1>
          <button
            type="button"
            class="nh-btn nh-btn-primario min-h-11 gap-1.5 px-3 text-sm lg:hidden"
            aria-label="Nueva conversación"
            (click)="newConversation()"
          >
            <nh-icon name="plus" />Nueva
          </button>
        </div>
        <div data-scroll-x class="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            class="nh-btn nh-btn-secundario min-h-10 shrink-0 gap-1.5 px-3 text-[13.5px]"
            aria-haspopup="dialog"
            (click)="panel.set('filters')"
          >
            <nh-icon name="filter" />{{
              chips().length ? 'Filtros (' + chips().length + ')' : 'Filtros'
            }}
          </button>
          @for (chip of chips(); track chip.key) {
            <span
              class="flex min-h-10 shrink-0 items-center gap-0.5 rounded-full bg-lavanda pl-3 text-[13.5px] font-semibold"
              >{{ chip.label
              }}<button
                type="button"
                class="flex size-[38px] items-center justify-center"
                [attr.aria-label]="chip.removeLabel"
                (click)="filters.set(chip.without)"
              >
                <nh-icon name="close" [size]="18" /></button
            ></span>
          }
          @if (chips().length) {
            <button
              type="button"
              class="nh-btn nh-btn-enlace min-h-10 shrink-0 text-[13.5px]"
              (click)="filters.set(emptyFilters())"
            >
              Limpiar filtros
            </button>
          } @else {
            <span class="min-w-0 pl-1 text-[13px] leading-tight text-ciruela-suave"
              >Buscando en todos los recuerdos disponibles</span
            >
          }
        </div>
      </div>

      <div
        #log
        role="log"
        aria-label="Conversación"
        class="min-h-0 flex-1 overflow-y-auto p-4 lg:px-10 lg:py-7"
      >
        <div class="mx-auto flex max-w-[720px] flex-col gap-4">
          @switch (state()) {
            @case ('loading') {
              <p role="status" class="m-0 text-[15px] text-ciruela-suave">
                Cargando la conversación…
              </p>
            }
            @case ('missing') {
              <div class="flex flex-col items-center gap-3.5 px-1 py-[18px] text-center">
                <h2 class="m-0 font-titulo text-[25px] font-medium">
                  Esta conversación ya no está disponible
                </h2>
                <button type="button" class="nh-btn nh-btn-primario" (click)="newConversation()">
                  Nueva conversación
                </button>
              </div>
            }
            @case ('error') {
              <nh-lista-estado
                state="error"
                errorTitle="No pudimos abrir la conversación"
                [reference]="reference()"
                (retry)="reloadConversation()"
              />
            }
            @default {
              @if (entries().length === 0) {
                <div class="flex flex-col items-center gap-3.5 px-1 py-[18px] text-center">
                  <nh-gatitos name="photos" width="190px" />
                  <h2 class="m-0 font-titulo text-[25px] font-medium leading-[1.2]">
                    Conversar sobre nuestra historia
                  </h2>
                  <p class="m-0 max-w-[330px] text-[15px] leading-[1.55] text-ciruela-medio">
                    Pregunta sobre lo que guardaron. La IA solo responde con recuerdos disponibles
                    para conversar y te dice de dónde sale cada respuesta.
                  </p>
                  <div class="flex w-full max-w-[340px] flex-col gap-2">
                    @for (suggestion of suggestions; track suggestion) {
                      <button
                        type="button"
                        class="min-h-[46px] rounded-[14px] border border-borde bg-papel px-3.5 py-2 text-left text-[15px] font-medium leading-[1.35]"
                        (click)="useSuggestion(suggestion)"
                      >
                        {{ suggestion }}
                      </button>
                    }
                  </div>
                </div>
              }
              @for (entry of entries(); track entry.requestId) {
                <div class="flex flex-col items-end gap-1.5">
                  <p
                    class="m-0 max-w-[82%] whitespace-pre-wrap rounded-[18px_18px_4px_18px] bg-ciruela px-4 py-3 text-base leading-normal text-papel"
                    [textContent]="entry.question"
                  ></p>
                  @if (entry.status === 'pending') {
                    <div
                      role="status"
                      class="flex items-center gap-2.5 self-start rounded-2xl border border-borde bg-papel py-2 pl-2 pr-3.5 text-[15px] font-medium text-ciruela-medio"
                    >
                      <nh-gatitos name="photos" width="84px" />Buscando entre sus recuerdos…
                    </div>
                  }
                  @if (entry.status === 'failed') {
                    <div
                      role="alert"
                      class="flex flex-col gap-2 self-stretch rounded-[14px] border border-[#E9B1AA] bg-[#FFF1EF] px-3.5 py-3 text-[#8A2B25]"
                    >
                      <span class="flex gap-1.5 text-[14.5px] font-semibold leading-snug"
                        ><nh-icon name="alert" />No pudimos obtener una respuesta. Tu pregunta sigue
                        aquí.</span
                      >
                      <button
                        type="button"
                        class="nh-btn min-h-10 gap-1.5 self-start border-[1.5px] border-[#D9A7A0] bg-papel px-3.5 text-sm text-ciruela"
                        [disabled]="asking()"
                        (click)="retry(entry)"
                      >
                        <nh-icon name="refresh" />Reintentar
                      </button>
                    </div>
                  }
                </div>
                @if (entry.status === 'completed') {
                  <div
                    class="flex max-w-[92%] flex-col gap-2.5 rounded-[4px_18px_18px_18px] p-4"
                    [class]="
                      entry.abstained
                        ? 'border-[1.5px] border-dashed border-[#CDBDB0] bg-[#FFFBF6]'
                        : 'border border-borde bg-papel'
                    "
                  >
                    <span
                      class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.05em] text-[#4E3F66]"
                      ><nh-icon name="sparkle" [size]="18" />Respuesta de la IA</span
                    >
                    <p
                      class="m-0 whitespace-pre-wrap text-[16.5px] leading-[1.6]"
                      [textContent]="entry.answer ?? ''"
                    ></p>
                    @if (entry.abstained) {
                      <p class="m-0 text-[14.5px] leading-normal text-ciruela-medio">
                        No hay un recuerdo disponible que respalde una respuesta. Si quieren, pueden
                        guardarlo como recuerdo y prepararlo para conversar.
                      </p>
                    }
                    @if (entry.citations.length) {
                      <div class="flex flex-col gap-1.5 border-t border-[#EFE3D7] pt-2.5">
                        <span class="text-[13px] font-semibold text-ciruela-suave">Basado en</span>
                        @for (citation of entry.citations; track citation.memoryId) {
                          <a
                            class="flex min-h-12 items-center gap-2.5 rounded-xl border border-borde bg-marfil px-3 py-1.5 text-left text-ciruela no-underline"
                            [routerLink]="['/app/timeline', citation.memoryId]"
                            [queryParams]="{ from: currentPath() }"
                            [attr.aria-label]="'Abrir recuerdo ' + citation.title"
                          >
                            <span class="text-accion"><nh-icon name="album" /></span>
                            <span class="flex flex-1 flex-col">
                              <span class="text-[15px] font-semibold text-accion underline">{{
                                citation.title
                              }}</span>
                              @if (citationDate(citation.memoryId); as date) {
                                <span class="text-[13px] text-ciruela-suave">{{ date }}</span>
                              }
                            </span>
                            <nh-icon name="fwd" />
                          </a>
                        }
                      </div>
                    }
                  </div>
                }
              }
            }
          }
        </div>
      </div>

      <div class="shrink-0 border-t border-borde bg-papel px-3 py-2.5">
        <div class="mx-auto flex max-w-[720px] flex-col gap-1.5">
          <label for="cv-q" class="sr-only">Tu pregunta</label>
          <div class="flex items-end gap-2">
            <textarea
              #questionBox
              id="cv-q"
              rows="2"
              class="nh-campo max-h-[140px] min-h-[52px] min-w-0 flex-1 resize-none rounded-2xl bg-marfil leading-[1.45]"
              placeholder="Pregunta algo sobre su historia…"
              aria-describedby="cv-q-ayuda"
              [value]="question()"
              [attr.aria-invalid]="tooLong()"
              (input)="question.set(questionBox.value)"
              (keydown)="questionKey($event)"
            ></textarea>
            <button
              type="button"
              class="nh-btn nh-btn-primario min-h-[52px] gap-1.5 rounded-2xl px-4"
              [disabled]="cannotAsk()"
              (click)="ask()"
            >
              @if (asking()) {
                <span class="nh-giro" aria-hidden="true"></span>Buscando…
              } @else {
                <nh-icon name="send" />Preguntar
              }
            </button>
          </div>
          <div id="cv-q-ayuda" class="flex justify-between gap-2 text-[12.5px] text-ciruela-suave">
            <span>Solo usa recuerdos disponibles para conversar.</span
            ><span>{{ questionCount() }}</span>
          </div>
          @if (tooLong()) {
            <p role="alert" class="m-0 text-[13.5px] font-medium text-error">
              La pregunta puede tener hasta 2000 caracteres.
            </p>
          }
          @if (filterRangeError()) {
            <p role="alert" class="m-0 text-[13.5px] font-medium text-error">
              Revisa las fechas de los filtros: {{ filterRangeError() }}
            </p>
          }
        </div>
      </div>
    </div>

    <nh-panel
      [open]="panel() === 'history'"
      labelledBy="panel-historial-titulo"
      (closed)="closePanel('history')"
    >
      <div class="flex flex-col gap-2.5">
        <div class="flex items-center justify-between">
          <h2 id="panel-historial-titulo" class="nh-panel-titulo">Tus conversaciones</h2>
          <button
            type="button"
            class="flex size-11 items-center justify-center rounded-full"
            aria-label="Cerrar historial"
            (click)="panel.set(null)"
          >
            <nh-icon name="close" />
          </button>
        </div>
        <button type="button" class="nh-btn nh-btn-primario" (click)="newConversation()">
          <nh-icon name="plus" />Nueva conversación
        </button>
        @for (item of conversations(); track item.conversationId) {
          <button
            type="button"
            class="flex min-h-14 flex-col gap-0.5 rounded-[14px] border border-borde px-3.5 py-2.5 text-left"
            [class]="item.conversationId === conversationId() ? 'bg-rosa-claro' : 'bg-transparent'"
            [attr.aria-current]="item.conversationId === conversationId() ? 'true' : null"
            (click)="openConversation(item.conversationId)"
          >
            <span
              class="text-[15.5px] leading-[1.3]"
              [class]="item.conversationId === conversationId() ? 'font-bold' : 'font-medium'"
              >{{ titleOf(item) }}</span
            >
            <span class="text-[13px] text-ciruela-suave">{{ dateOf(item) }}</span>
          </button>
        }
        <p class="mb-0 mt-1 text-[13px] leading-normal text-ciruela-suave">
          Solo tú ves tus conversaciones. Los recuerdos pertenecen al espacio compartido.
        </p>
      </div>
    </nh-panel>

    <nh-panel
      [open]="panel() === 'filters'"
      labelledBy="panel-filtros-titulo"
      (closed)="closePanel('filters')"
    >
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h2 id="panel-filtros-titulo" class="nh-panel-titulo">Filtros</h2>
          <button
            type="button"
            class="flex size-11 items-center justify-center rounded-full"
            aria-label="Cerrar filtros"
            (click)="panel.set(null)"
          >
            <nh-icon name="close" />
          </button>
        </div>
        <p class="m-0 text-sm leading-normal text-ciruela-medio">
          Limita los recuerdos que la IA consulta en esta conversación. Tu pregunta escrita se
          conserva.
        </p>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
          <div class="flex flex-col gap-1.5">
            <label for="fl-from" class="nh-etiqueta-campo">Fecha inicial</label>
            <input
              id="fl-from"
              type="date"
              class="nh-campo min-h-12"
              [value]="filters().from"
              [attr.aria-invalid]="!!filterRangeError()"
              (input)="setFilter('from', $event)"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="fl-to" class="nh-etiqueta-campo">Fecha final</label>
            <input
              id="fl-to"
              type="date"
              class="nh-campo min-h-12"
              [value]="filters().to"
              [attr.aria-invalid]="!!filterRangeError()"
              (input)="setFilter('to', $event)"
            />
          </div>
        </div>
        @if (filterRangeError()) {
          <p role="alert" class="nh-error-campo">
            <nh-icon name="alert" />{{ filterRangeError() }}
          </p>
        }
        <fieldset class="m-0 border-0 p-0">
          <legend class="nh-etiqueta-campo mb-2 p-0">Categoría</legend>
          <div class="flex flex-wrap gap-1.5">
            <label class="nh-opcion min-h-[42px] flex-none rounded-full px-3.5 text-sm"
              ><input
                type="radio"
                name="fl-category"
                class="sr-only"
                [checked]="filters().category === ''"
                (change)="filters.set({ ...filters(), category: '' })"
              />Todas</label
            >
            @for (category of options().categories; track category) {
              <label class="nh-opcion min-h-[42px] flex-none rounded-full px-3.5 text-sm"
                ><input
                  type="radio"
                  name="fl-category"
                  class="sr-only"
                  [checked]="filters().category === category"
                  (change)="filters.set({ ...filters(), category })"
                />{{ category }}</label
              >
            }
          </div>
        </fieldset>
        @if (options().tags.length) {
          <fieldset class="m-0 border-0 p-0">
            <legend class="nh-etiqueta-campo mb-2 p-0">Etiquetas</legend>
            <div class="flex flex-wrap gap-1.5">
              @for (tag of options().tags; track tag) {
                <label
                  class="nh-opcion min-h-[42px] flex-none rounded-full border-campo px-3 text-sm font-medium"
                  ><input
                    type="checkbox"
                    class="sr-only"
                    [checked]="filters().tags.includes(tag)"
                    (change)="toggleTag(tag)"
                  />#{{ tag }}</label
                >
              }
            </div>
          </fieldset>
        }
        <div class="flex gap-2.5">
          <button
            type="button"
            class="nh-btn nh-btn-secundario min-h-[50px] flex-1"
            (click)="filters.set(emptyFilters())"
          >
            Limpiar filtros
          </button>
          <button
            type="button"
            class="nh-btn nh-btn-primario min-h-[50px] flex-1"
            (click)="panel.set(null)"
          >
            Aplicar
          </button>
        </div>
      </div>
    </nh-panel>
  `,
})
export class ChatComponent {
  private readonly api = inject(ChatApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly live = inject(LiveAnnouncer);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  private readonly questionBox = viewChild<ElementRef<HTMLTextAreaElement>>('questionBox');

  protected readonly suggestions = SUGGESTIONS;
  protected readonly emptyFilters = noFilters;
  protected readonly conversationId = signal<string | null>(null);
  protected readonly title = signal('Nueva conversación');
  protected readonly conversations = signal<readonly ConversationSummary[]>([]);
  protected readonly entries = signal<readonly ChatEntry[]>([]);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('ready');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly filters = signal<ChatFilters>(noFilters());
  protected readonly panel = signal<'history' | 'filters' | null>(null);
  private readonly memories = signal<readonly MemoryDto[]>([]);

  protected readonly chips = computed(() => filterChips(this.filters()));
  protected readonly filterRangeError = computed(() => rangeError(this.filters()));
  protected readonly options = computed(() => filterOptions(this.memories(), this.filters()));
  protected readonly tooLong = computed(() => this.question().length > QUESTION_MAX);
  protected readonly questionCount = computed(() => counterLabel(this.question(), QUESTION_MAX));
  protected readonly cannotAsk = computed(
    () =>
      this.question().trim() === '' ||
      this.asking() ||
      this.tooLong() ||
      this.filterRangeError() !== null,
  );
  protected readonly currentPath = computed(() => {
    const id = this.conversationId();
    return id === null ? '/app/chat' : `/app/chat/${id}`;
  });
  private readonly memoryDates = computed(
    () => new Map(this.memories().map((memory) => [memory.memoryId, memory.occurredOn])),
  );

  public constructor() {
    void this.loadHistory();
    void this.memoriesApi
      .timeline()
      .then((page) => this.memories.set(page.items))
      .catch(() => undefined);
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('conversationId');
      if (id !== null && id === this.conversationId()) return;
      this.conversationId.set(id);
      this.entries.set([]);
      this.title.set('Nueva conversación');
      this.state.set('ready');
      if (id !== null) void this.loadConversation(id);
    });
    effect(() => {
      this.entries();
      const log = this.log()?.nativeElement;
      if (log !== undefined) setTimeout(() => (log.scrollTop = log.scrollHeight));
    });
  }

  protected titleOf(item: ConversationSummary): string {
    return conversationTitle(item.title);
  }

  protected dateOf(item: ConversationSummary): string {
    return formatShortInstant(item.updatedAt);
  }

  protected citationDate(memoryId: string): string | undefined {
    const date = this.memoryDates().get(memoryId);
    return date === undefined ? undefined : formatShortDate(date);
  }

  protected closePanel(panel: 'history' | 'filters'): void {
    if (this.panel() === panel) this.panel.set(null);
  }

  protected setFilter(field: 'from' | 'to', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.filters.update((filters) => ({ ...filters, [field]: value }));
  }

  protected toggleTag(tag: string): void {
    this.filters.update((filters) => ({
      ...filters,
      tags: filters.tags.includes(tag)
        ? filters.tags.filter((item) => item !== tag)
        : [...filters.tags, tag],
    }));
  }

  protected useSuggestion(suggestion: string): void {
    this.question.set(suggestion);
    this.questionBox()?.nativeElement.focus();
  }

  protected questionKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void this.ask();
    }
  }

  protected async newConversation(): Promise<void> {
    this.panel.set(null);
    if (this.conversationId() === null) {
      this.questionBox()?.nativeElement.focus();
      return;
    }
    await this.router.navigate(['/app/chat']);
  }

  protected async openConversation(id: string): Promise<void> {
    this.panel.set(null);
    await this.router.navigate(['/app/chat', id]);
  }

  protected reloadConversation(): void {
    const id = this.conversationId();
    if (id !== null) void this.loadConversation(id);
  }

  protected async ask(): Promise<void> {
    const question = this.question().trim();
    if (this.cannotAsk()) return;
    const entry: ChatEntry = {
      requestId: crypto.randomUUID(),
      question,
      filters: retrievalFilters(this.filters()),
      status: 'pending',
      answer: undefined,
      citations: [],
      abstained: false,
    };
    this.question.set('');
    this.entries.update((entries) => [...entries, entry]);
    await this.send(entry);
  }

  protected async retry(entry: ChatEntry): Promise<void> {
    if (this.asking()) return;
    this.replace({ ...entry, status: 'pending' });
    await this.send(entry);
  }

  /** Sends (or re-sends, with the same request ID and question) one question. */
  private async send(entry: ChatEntry): Promise<void> {
    this.asking.set(true);
    this.live.announce('Buscando entre sus recuerdos…');
    try {
      const conversationId = await this.ensureConversation();
      const turn = await this.api.send(conversationId, {
        requestId: entry.requestId,
        question: entry.question,
        ...(entry.filters === undefined ? {} : { filters: entry.filters }),
      });
      this.replace(entryFrom(turn));
      this.live.announce('Respuesta lista.');
      await this.loadHistory();
    } catch {
      this.replace({ ...entry, status: 'failed' });
      this.live.announce('No pudimos obtener una respuesta.');
    } finally {
      this.asking.set(false);
    }
  }

  private async ensureConversation(): Promise<string> {
    const current = this.conversationId();
    if (current !== null) return current;
    const created = await this.api.createConversation();
    this.conversationId.set(created.conversationId);
    await this.router.navigate(['/app/chat', created.conversationId], { replaceUrl: true });
    return created.conversationId;
  }

  private replace(entry: ChatEntry): void {
    this.entries.update((entries) =>
      entries.map((item) => (item.requestId === entry.requestId ? entry : item)),
    );
  }

  private async loadConversation(id: string): Promise<void> {
    this.state.set('loading');
    try {
      const conversation = await this.api.get(id);
      if (this.conversationId() !== id) return;
      this.title.set(conversationTitle(conversation.title));
      this.entries.set(conversation.turns.map(entryFrom));
      this.state.set('ready');
    } catch (error) {
      this.reference.set(supportReference(error));
      this.state.set(isNotFound(error) ? 'missing' : 'error');
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      const items = (await this.api.list()).items;
      this.conversations.set(items);
      const current = items.find((item) => item.conversationId === this.conversationId());
      if (current !== undefined) this.title.set(conversationTitle(current.title));
    } catch {
      /* The current conversation stays usable without the history list. */
    }
  }
}
