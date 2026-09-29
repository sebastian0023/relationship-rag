import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type {
  CardDto,
  CardRecipient,
  CardTone,
  GeneratedCardDraft,
  Locale,
  MemoryDto,
} from '@relationship-rag/contracts';
import { failureMessage, isNotFound, supportReference } from './api/api-error.js';
import { CardsApiService } from './cards-api.service.js';
import { CardDraftStore } from './cards/card-draft-store.service.js';
import {
  CARD_LIMITS,
  TONES,
  applyProposal,
  cardFormFrom,
  cardFormKey,
  emptyCardForm,
  isCardFormDirty,
  toggleReference,
  validateCardForm,
  withoutReference,
  type CardField,
  type CardFormErrors,
  type CardFormValue,
} from './cards/card-form.js';
import { MemoriesApiService } from './memories-api.service.js';
import { LiveAnnouncer, ToastService } from './ui/avisos.service.js';
import { counterLabel, formatShortDate, initialOf } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';
import { PanelComponent } from './ui/panel.component.js';
import { LeaveDecision, type GuardsUnsavedChanges } from './ui/unsaved-changes.guard.js';

interface MemoryLabel {
  readonly title: string;
  readonly date: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GatitosComponent,
    IconComponent,
    ListaEstadoComponent,
    NgTemplateOutlet,
    PanelComponent,
    RouterLink,
  ],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)', class: 'flex flex-1 flex-col' },
  template: `
    @switch (state()) {
      @case ('loading') {
        <div role="status" aria-busy="true" class="px-4 py-8 text-[15px] text-ciruela-suave">
          Cargando la tarjeta…
        </div>
      }
      @case ('missing') {
        <div class="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <nh-gatitos name="envelope" />
          <h1 class="m-0 font-titulo text-[26px] font-medium leading-[1.2]">
            Esta tarjeta ya no está disponible
          </h1>
          <a routerLink="/app/cards" class="nh-btn nh-btn-primario px-[22px]">Ir a Tarjetas</a>
        </div>
      }
      @case ('no-partner') {
        <div class="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <nh-gatitos name="envelope" />
          <h1 class="m-0 font-titulo text-[26px] font-medium leading-[1.2]">
            Todavía no hay a quién escribirle
          </h1>
          <p class="m-0 max-w-[320px] text-[15px] leading-[1.55] text-ciruela-medio">
            Cuando tu pareja acepte su invitación, podrás escribirle tarjetas aquí.
          </p>
          <a routerLink="/app/cards" class="nh-btn nh-btn-primario px-[22px]">Ir a Tarjetas</a>
        </div>
      }
      @case ('error') {
        <div class="px-4 py-8">
          <nh-lista-estado
            state="error"
            errorTitle="No pudimos abrir la tarjeta"
            [reference]="reference()"
            (retry)="load()"
          />
        </div>
      }
      @default {
        <div class="flex flex-1 flex-col">
          <div class="nh-barra-superior">
            <button type="button" class="nh-btn nh-btn-texto gap-1" (click)="goToCards()">
              <nh-icon name="back" />Tarjetas
            </button>
            <span
              aria-live="polite"
              class="flex items-center gap-1.5 text-[13px] font-semibold"
              [style.color]="statusColor()"
              ><span
                aria-hidden="true"
                class="size-2 rounded-full"
                [style.background]="statusColor()"
              ></span
              >{{ statusLabel() }}</span
            >
            <button
              type="button"
              class="nh-btn nh-btn-secundario min-h-11 gap-1.5 px-3 text-sm lg:hidden"
              aria-haspopup="dialog"
              (click)="panel.set('preview')"
            >
              <nh-icon name="eye" />Vista previa
            </button>
            <span class="hidden w-[120px] lg:block"></span>
          </div>
          <div
            class="mx-auto box-border grid w-full max-w-[1080px] flex-1 grid-cols-1 items-start gap-9 px-4 pb-8 pt-5 lg:grid-cols-2 lg:px-12 lg:pb-16 lg:pt-9"
          >
            <div class="flex min-w-0 flex-col gap-[22px]">
              <h1 class="m-0 font-titulo text-[30px] font-medium leading-[1.15]">
                Una tarjeta para {{ partnerName() }}
              </h1>
              <div class="flex flex-col gap-1.5">
                <span class="nh-etiqueta-campo">Para</span>
                <div
                  class="flex min-h-[50px] items-center gap-2.5 rounded-xl bg-arena px-3.5 text-base font-semibold"
                >
                  <span
                    aria-hidden="true"
                    class="flex size-[30px] items-center justify-center rounded-full bg-durazno text-[13px] font-bold"
                    >{{ partnerInitial() }}</span
                  >{{ partnerName() }}
                </div>
                <p class="m-0 text-[13.5px] leading-[1.45] text-ciruela-suave">
                  {{
                    cardId() === null
                      ? 'Tu pareja. El destinatario queda fijado al guardar el borrador por primera vez.'
                      : 'Destinatario fijado al guardar el borrador.'
                  }}
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between gap-2">
                  <label for="ce-occ" class="nh-etiqueta-campo"
                    >Ocasión <span class="text-accion" aria-hidden="true">*</span></label
                  ><span class="text-[13px] font-medium text-ciruela-suave">{{
                    counter(form().occasion, limits.occasion)
                  }}</span>
                </div>
                <input
                  id="ce-occ"
                  class="nh-campo"
                  required
                  placeholder="Por ejemplo: ánimo antes de un día importante"
                  [value]="form().occasion"
                  [attr.aria-invalid]="!!errors().occasion"
                  [attr.aria-describedby]="errors().occasion ? 'ce-occ-e' : null"
                  (input)="setText('occasion', $event)"
                />
                @if (errors().occasion) {
                  <p id="ce-occ-e" class="nh-error-campo">
                    <nh-icon name="alert" />{{ errors().occasion }}
                  </p>
                }
              </div>
              <fieldset class="m-0 border-0 p-0">
                <legend class="nh-etiqueta-campo mb-2 p-0">Tono</legend>
                <div class="grid grid-cols-2 gap-2">
                  @for (tone of tones; track tone.value) {
                    <label
                      class="nh-foco-interno flex min-h-[46px] cursor-pointer items-center justify-center rounded-xl border-[1.5px] text-[15px]"
                      [class]="
                        form().tone === tone.value
                          ? 'border-ciruela font-bold'
                          : 'border-campo bg-papel font-medium'
                      "
                      [style.background]="form().tone === tone.value ? tone.color : null"
                      ><input
                        type="radio"
                        name="ce-tone"
                        class="sr-only"
                        [checked]="form().tone === tone.value"
                        (change)="setTone(tone.value)"
                      />{{ tone.label }}</label
                    >
                  }
                </div>
              </fieldset>
              <fieldset class="m-0 border-0 p-0">
                <legend class="nh-etiqueta-campo mb-2 p-0">Idioma del contenido</legend>
                <div class="flex gap-1.5">
                  @for (option of locales; track option.value) {
                    <label class="nh-opcion"
                      ><input
                        type="radio"
                        name="ce-locale"
                        class="sr-only"
                        [checked]="form().locale === option.value"
                        (change)="setLocale(option.value)"
                      />{{ option.label }}</label
                    >
                  }
                </div>
              </fieldset>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="nh-etiqueta-campo"
                    >Recuerdos de referencia
                    <span class="font-normal text-ciruela-suave">(opcional)</span></span
                  ><span class="text-[13px] font-medium text-ciruela-suave"
                    >{{ form().memoryIds.length }} de 20</span
                  >
                </div>
                @if (form().memoryIds.length) {
                  <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    @for (id of form().memoryIds; track id) {
                      <li
                        class="flex min-h-[38px] items-center gap-1 rounded-full bg-salvia py-0 pl-2.5 pr-0.5 text-sm font-medium"
                      >
                        <nh-icon name="album" [size]="18" />{{ label(id).title }}
                        <button
                          type="button"
                          class="flex size-9 items-center justify-center rounded-full"
                          [attr.aria-label]="'Quitar referencia ' + label(id).title"
                          (click)="removeReference(id)"
                        >
                          <nh-icon name="close" [size]="18" />
                        </button>
                      </li>
                    }
                  </ul>
                }
                <button
                  type="button"
                  class="nh-btn nh-btn-secundario min-h-11 gap-2 self-start px-3.5 text-sm"
                  aria-haspopup="dialog"
                  (click)="panel.set('refs')"
                >
                  <nh-icon name="plus" />Elegir recuerdos
                </button>
              </div>

              <section
                aria-labelledby="ayuda-ia-titulo"
                class="flex flex-col gap-3 rounded-2xl border border-[#DCD0EA] bg-[#F4EFF9] p-4"
              >
                <div class="flex items-center gap-2 text-[#4E3F66]">
                  <nh-icon name="sparkle" />
                  <h2 id="ayuda-ia-titulo" class="m-0 text-base font-semibold text-ciruela">
                    Ayuda para escribir
                  </h2>
                </div>
                <p class="m-0 text-sm leading-normal text-ciruela-medio">
                  La propuesta usa solo los recuerdos que elijas. Sin recuerdos, escribe un mensaje
                  general sin inventar detalles de su historia.
                </p>
                @if (generating()) {
                  <div
                    role="status"
                    class="flex min-h-[46px] items-center gap-2.5 text-[15px] font-medium text-[#4E3F66]"
                  >
                    <span class="nh-giro" aria-hidden="true"></span>Escribiendo una propuesta…
                  </div>
                } @else if (proposal(); as draft) {
                  <div
                    class="flex flex-col gap-2.5 rounded-xl border-[1.5px] border-dashed border-[#B9A7D1] bg-papel p-4"
                  >
                    <span class="text-xs font-bold uppercase tracking-[.06em] text-[#4E3F66]"
                      >Propuesta · aún no está en tu tarjeta</span
                    >
                    <h3 class="m-0 font-titulo text-xl font-medium">{{ draft.title }}</h3>
                    <p
                      class="m-0 whitespace-pre-wrap text-[15.5px] leading-[1.65]"
                      [textContent]="draft.body"
                    ></p>
                    @if (draft.citedMemoryIds.length) {
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-[13px] font-semibold text-ciruela-suave">Usa:</span>
                        @for (id of draft.citedMemoryIds; track id) {
                          <a
                            class="flex min-h-9 items-center rounded-full border border-campo bg-papel px-2.5 text-[13px] font-semibold text-accion underline"
                            [routerLink]="['/app/timeline', id]"
                            [queryParams]="{ from: currentPath() }"
                            >{{ label(id).title }}</a
                          >
                        }
                      </div>
                    } @else {
                      <p class="m-0 text-[13px] text-ciruela-suave">
                        Mensaje general: no usa recuerdos.
                      </p>
                    }
                    @if (confirmReplace()) {
                      <div
                        role="alert"
                        class="rounded-[10px] bg-[#F7E9D6] px-3 py-2.5 text-sm font-medium leading-[1.45] text-[#6A4A1E]"
                      >
                        Ya escribiste un mensaje. Si usas la propuesta, reemplazará tu mensaje
                        actual. Pulsa otra vez «Usar esta propuesta» para confirmarlo.
                      </div>
                    }
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="nh-btn nh-btn-primario min-h-11 px-4 text-sm"
                        (click)="useProposal()"
                      >
                        Usar esta propuesta
                      </button>
                      <button
                        type="button"
                        class="nh-btn nh-btn-secundario min-h-11 px-3.5 text-sm"
                        (click)="generate()"
                      >
                        Generar otra propuesta
                      </button>
                      @if (confirmReplace()) {
                        <button
                          type="button"
                          class="nh-btn nh-btn-texto min-h-11 text-sm"
                          (click)="confirmReplace.set(false)"
                        >
                          Conservar mi mensaje
                        </button>
                      }
                      <button
                        type="button"
                        class="nh-btn nh-btn-texto min-h-11 text-sm text-ciruela-medio"
                        (click)="discardProposal()"
                      >
                        Descartar propuesta
                      </button>
                    </div>
                  </div>
                } @else {
                  <button
                    type="button"
                    class="nh-btn nh-btn-oscuro min-h-[46px] self-start px-[18px]"
                    (click)="generate()"
                  >
                    <nh-icon name="sparkle" />{{
                      proposalCount() ? 'Generar otra propuesta' : 'Generar propuesta'
                    }}
                  </button>
                }
              </section>

              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between gap-2">
                  <label for="ce-title" class="nh-etiqueta-campo"
                    >Título <span class="text-accion" aria-hidden="true">*</span></label
                  ><span class="text-[13px] font-medium text-ciruela-suave">{{
                    counter(form().title, limits.title)
                  }}</span>
                </div>
                <input
                  id="ce-title"
                  class="nh-campo"
                  required
                  placeholder="Una tarjeta para ti"
                  [value]="form().title"
                  [attr.aria-invalid]="!!errors().title"
                  [attr.aria-describedby]="errors().title ? 'ce-title-e' : null"
                  (input)="setText('title', $event)"
                />
                @if (errors().title) {
                  <p id="ce-title-e" class="nh-error-campo">
                    <nh-icon name="alert" />{{ errors().title }}
                  </p>
                }
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between gap-2">
                  <label for="ce-msg" class="nh-etiqueta-campo"
                    >Mensaje <span class="text-accion" aria-hidden="true">*</span></label
                  ><span class="text-[13px] font-medium text-ciruela-suave">{{
                    counter(form().body, limits.body)
                  }}</span>
                </div>
                <p id="ce-msg-h" class="m-0 text-[13.5px] text-ciruela-suave">
                  Texto sencillo, sin formato. Los saltos de línea se respetan.
                </p>
                <textarea
                  id="ce-msg"
                  rows="9"
                  required
                  class="nh-campo min-h-[220px] resize-y p-3.5 leading-[1.65]"
                  placeholder="Escribe con calma…"
                  [value]="form().body"
                  [attr.aria-invalid]="!!errors().body"
                  [attr.aria-describedby]="errors().body ? 'ce-msg-h ce-msg-e' : 'ce-msg-h'"
                  (input)="setText('body', $event)"
                ></textarea>
                @if (errors().body) {
                  <p id="ce-msg-e" class="nh-error-campo">
                    <nh-icon name="alert" />{{ errors().body }}
                  </p>
                }
              </div>
              @if (cardId() !== null) {
                <button
                  type="button"
                  class="nh-btn nh-btn-peligro self-start"
                  (click)="panel.set('delete')"
                >
                  <nh-icon name="trash" />Eliminar borrador
                </button>
              }
            </div>
            <aside
              aria-label="Vista previa"
              class="sticky top-[76px] hidden flex-col gap-2.5 lg:flex"
            >
              <span class="text-xs font-bold uppercase tracking-[.06em] text-ciruela-suave"
                >Vista previa</span
              >
              <ng-container *ngTemplateOutlet="letterPreview" />
            </aside>
          </div>
          <div class="nh-barra-inferior">
            <button
              type="button"
              class="nh-btn nh-btn-contorno min-h-[52px] max-w-[240px] flex-1 gap-2"
              [disabled]="saving()"
              (click)="saveDraft()"
            >
              @if (saving()) {
                <span class="nh-giro" aria-hidden="true"></span>Guardando…
              } @else {
                Guardar borrador
              }
            </button>
            <button
              type="button"
              class="nh-btn nh-btn-primario min-h-[52px] max-w-[240px] flex-1"
              [disabled]="saving()"
              (click)="review()"
            >
              Revisar y enviar
            </button>
          </div>
        </div>

        <ng-template #letterPreview>
          <div
            class="flex rotate-[.6deg] flex-col gap-3.5 rounded-md bg-papel bg-[repeating-linear-gradient(transparent_0_29px,#F3E9DF_29px_30px)] px-[34px] py-9 shadow-[0_2px_6px_rgba(56,43,54,.08),0_18px_40px_rgba(56,43,54,.10)]"
          >
            <p class="m-0 text-[13px] font-semibold text-ciruela-suave">Para {{ partnerName() }}</p>
            <h2 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">
              {{ form().title || 'Sin título' }}
            </h2>
            <p
              class="m-0 whitespace-pre-wrap font-titulo text-[17px] leading-[30px]"
              [class]="form().body ? 'text-ciruela' : 'text-ciruela-suave'"
              [textContent]="form().body || 'Tu mensaje aparecerá aquí mientras escribes.'"
            ></p>
          </div>
        </ng-template>

        <nh-panel
          [open]="panel() === 'preview'"
          labelledBy="panel-vista-titulo"
          (closed)="closePanel('preview')"
        >
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h2 id="panel-vista-titulo" class="m-0 text-[15px] font-semibold">Vista previa</h2>
              <button type="button" class="nh-btn nh-btn-texto gap-1" (click)="panel.set(null)">
                <nh-icon name="close" />Volver a editar
              </button>
            </div>
            <ng-container *ngTemplateOutlet="letterPreview" />
          </div>
        </nh-panel>

        <nh-panel
          [open]="panel() === 'refs'"
          labelledBy="panel-refs-titulo"
          (closed)="closePanel('refs')"
        >
          <div class="flex flex-col gap-2.5">
            <div class="flex items-center justify-between">
              <h2 id="panel-refs-titulo" class="nh-panel-titulo">Recuerdos de referencia</h2>
              <button
                type="button"
                class="flex size-11 items-center justify-center rounded-full"
                aria-label="Cerrar"
                (click)="panel.set(null)"
              >
                <nh-icon name="close" />
              </button>
            </div>
            <p class="m-0 text-sm leading-normal text-ciruela-medio">
              Elige hasta 20. La propuesta de la IA solo usará estos recuerdos.
            </p>
            @for (memory of memories(); track memory.memoryId) {
              <label
                class="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-borde bg-papel px-3 py-2"
              >
                <input
                  type="checkbox"
                  class="size-[22px] shrink-0 accent-accion"
                  [checked]="form().memoryIds.includes(memory.memoryId)"
                  [disabled]="
                    !form().memoryIds.includes(memory.memoryId) &&
                    form().memoryIds.length >= limits.memories
                  "
                  (change)="toggleMemory(memory.memoryId)"
                />
                <span class="flex flex-col">
                  <span class="text-[15px] font-semibold">{{ memory.title }}</span>
                  <span class="text-[13px] text-ciruela-suave">{{
                    shortDate(memory.occurredOn)
                  }}</span>
                </span>
              </label>
            } @empty {
              <p class="m-0 text-sm text-ciruela-suave">Todavía no hay recuerdos guardados.</p>
            }
            @if (memoriesCursor()) {
              <button
                type="button"
                class="nh-btn nh-btn-secundario"
                [disabled]="loadingMemories()"
                (click)="loadMoreMemories()"
              >
                Cargar recuerdos anteriores
              </button>
            }
            <button
              type="button"
              class="nh-btn nh-btn-primario min-h-[50px]"
              (click)="panel.set(null)"
            >
              Listo · {{ form().memoryIds.length }} de 20
            </button>
          </div>
        </nh-panel>

        <nh-panel
          [open]="panel() === 'delete'"
          labelledBy="panel-borrar-titulo"
          (closed)="closePanel('delete')"
        >
          <div class="flex flex-col gap-3.5">
            <h2 id="panel-borrar-titulo" class="nh-panel-titulo">
              ¿Eliminar el borrador «{{ form().title || 'Sin título' }}»?
            </h2>
            <p class="nh-panel-texto">
              {{ partnerName() }} nunca lo vio. Esta acción no se puede deshacer.
            </p>
            <button
              type="button"
              class="nh-btn nh-btn-oscuro nh-btn-panel"
              (click)="panel.set(null)"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="nh-btn nh-btn-peligro-contorno nh-btn-panel"
              [disabled]="deleting()"
              (click)="deleteDraft()"
            >
              Eliminar borrador
            </button>
          </div>
        </nh-panel>
      }
    }

    <nh-panel
      [open]="panel() === 'leave'"
      labelledBy="panel-salir-tarjeta-titulo"
      (closed)="closeLeave()"
    >
      <div class="flex flex-col gap-3.5">
        <h2 id="panel-salir-tarjeta-titulo" class="nh-panel-titulo">¿Salir sin guardar?</h2>
        <p class="nh-panel-texto">Tu tarjeta tiene cambios sin guardar. Si sales, se perderán.</p>
        <button type="button" class="nh-btn nh-btn-oscuro nh-btn-panel" (click)="closeLeave()">
          Seguir editando
        </button>
        <button
          type="button"
          class="nh-btn nh-btn-peligro-contorno nh-btn-panel"
          (click)="leaveWithoutSaving()"
        >
          Salir sin guardar
        </button>
      </div>
    </nh-panel>
  `,
})
export class CardEditorComponent implements GuardsUnsavedChanges {
  private readonly api = inject(CardsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(CardDraftStore);
  private readonly toasts = inject(ToastService);
  private readonly live = inject(LiveAnnouncer);
  private readonly leave = new LeaveDecision();
  private readonly clientRequestId = crypto.randomUUID();

  protected readonly tones = TONES;
  protected readonly limits = CARD_LIMITS;
  protected readonly locales: readonly { value: Locale; label: string }[] = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'Inglés' },
  ];
  protected readonly cardId = signal<string | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'no-partner' | 'error'>(
    'loading',
  );
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly recipient = signal<CardRecipient | null>(null);
  protected readonly form = signal<CardFormValue>(emptyCardForm());
  protected readonly errors = signal<CardFormErrors>({});
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly generating = signal(false);
  protected readonly proposal = signal<GeneratedCardDraft | null>(null);
  protected readonly proposalCount = signal(0);
  protected readonly confirmReplace = signal(false);
  protected readonly panel = signal<'refs' | 'preview' | 'delete' | 'leave' | null>(null);
  protected readonly memories = signal<readonly MemoryDto[]>([]);
  protected readonly memoriesCursor = signal<string | undefined>(undefined);
  protected readonly loadingMemories = signal(false);
  private readonly extraLabels = signal<ReadonlyMap<string, MemoryLabel>>(new Map());
  private readonly savedKey = signal<string | null>(null);
  private readonly version = signal(0);

  protected readonly dirty = computed(() => isCardFormDirty(this.form(), this.savedKey()));
  protected readonly partnerName = computed(() => this.recipient()?.displayName ?? 'tu pareja');
  protected readonly partnerInitial = computed(() => initialOf(this.recipient()?.displayName));
  protected readonly currentPath = computed(() => `/app/cards/${this.cardId() ?? 'new'}`);
  protected readonly statusLabel = computed(() => {
    if (this.saving()) return 'Guardando…';
    if (this.dirty()) return 'Cambios sin guardar';
    return this.cardId() === null ? 'Borrador nuevo' : 'Borrador guardado';
  });
  protected readonly statusColor = computed(() => {
    if (this.saving() || this.dirty()) return '#8A5A1F';
    return this.cardId() === null ? '#6B5A66' : '#3F6B45';
  });
  private readonly labels = computed(() => {
    const labels = new Map(this.extraLabels());
    for (const memory of this.memories())
      labels.set(memory.memoryId, {
        title: memory.title,
        date: formatShortDate(memory.occurredOn),
      });
    return labels;
  });

  public constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const param = params.get('cardId');
      const id = param === null || param === 'new' ? null : param;
      if (id !== null && id === this.cardId()) return;
      this.cardId.set(id);
      void this.load();
    });
    effect(() => {
      const id = this.cardId();
      const savedKey = this.savedKey();
      if (id !== null && savedKey !== null)
        this.store.edit(id, this.version(), this.form(), savedKey);
    });
  }

  public canLeave(nextUrl: string): boolean | Promise<boolean> {
    const id = this.cardId();
    if (!this.dirty()) return true;
    if (id !== null && nextUrl.startsWith(`/app/cards/${id}/review`)) return true;
    this.panel.set('leave');
    return this.leave.ask();
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [recipients, timeline] = await Promise.all([
        this.api.recipients(),
        this.memoriesApi.timeline(),
      ]);
      this.memories.set(timeline.items);
      this.memoriesCursor.set(timeline.nextCursor);
      const id = this.cardId();
      if (id === null) {
        const recipient = recipients[0];
        if (recipient === undefined) {
          this.state.set('no-partner');
          return;
        }
        this.recipient.set(recipient);
        this.state.set('ready');
        return;
      }
      const card = await this.api.get(id);
      if (card.status !== 'DRAFT') {
        await this.router.navigate(['/app/cards', id, 'view'], { replaceUrl: true });
        return;
      }
      this.recipient.set({ userId: card.recipientUserId, displayName: card.recipientDisplayName });
      const buffered = this.store.forCard(id);
      if (buffered !== null && buffered.version === card.version) {
        this.version.set(buffered.version);
        this.form.set(buffered.form);
        this.savedKey.set(buffered.savedKey);
      } else {
        this.adopt(card);
      }
      void this.ensureLabels([...card.memoryIds, ...card.citedMemoryIds]);
      this.state.set('ready');
    } catch (error) {
      this.reference.set(supportReference(error));
      this.state.set(isNotFound(error) ? 'missing' : 'error');
    }
  }

  protected label(memoryId: string): MemoryLabel {
    return this.labels().get(memoryId) ?? { title: 'Recuerdo no disponible', date: '' };
  }

  protected shortDate(date: string): string {
    return formatShortDate(date);
  }

  protected counter(value: string, max: number): string {
    return counterLabel(value, max);
  }

  protected setText(field: CardField, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.form.update((form) => ({ ...form, [field]: value }));
    this.clearError(field);
  }

  protected setTone(tone: CardTone): void {
    this.form.update((form) => ({ ...form, tone }));
  }

  protected setLocale(locale: Locale): void {
    this.form.update((form) => ({ ...form, locale }));
  }

  protected toggleMemory(memoryId: string): void {
    this.form.update((form) => toggleReference(form, memoryId));
  }

  protected removeReference(memoryId: string): void {
    this.form.update((form) => withoutReference(form, memoryId));
    this.live.announce(`Quitamos «${this.label(memoryId).title}» de las referencias`);
  }

  protected closePanel(panel: 'refs' | 'preview' | 'delete'): void {
    if (this.panel() === panel) this.panel.set(null);
  }

  protected closeLeave(): void {
    this.panel.set(null);
    this.leave.answer(false);
  }

  protected leaveWithoutSaving(): void {
    this.panel.set(null);
    this.store.clear();
    this.leave.answer(true);
  }

  protected goToCards(): void {
    void this.router.navigateByUrl('/app/cards');
  }

  protected async loadMoreMemories(): Promise<void> {
    const cursor = this.memoriesCursor();
    if (cursor === undefined || this.loadingMemories()) return;
    this.loadingMemories.set(true);
    try {
      const page = await this.memoriesApi.timeline(cursor);
      this.memories.update((memories) => [...memories, ...page.items]);
      this.memoriesCursor.set(page.nextCursor);
    } catch (error) {
      this.toasts.show(failureMessage(error, 'No pudimos cargar más recuerdos.'), 'err');
    } finally {
      this.loadingMemories.set(false);
    }
  }

  protected async generate(): Promise<void> {
    const recipient = this.recipient();
    if (this.generating() || recipient === null) return;
    const form = this.form();
    if (form.occasion.trim() === '') {
      this.errors.update((errors) => ({
        ...errors,
        occasion: 'Escribe la ocasión para orientar la propuesta.',
      }));
      return;
    }
    this.generating.set(true);
    this.confirmReplace.set(false);
    this.live.announce('Escribiendo una propuesta…');
    try {
      const draft = await this.api.generate({
        recipientUserId: recipient.userId,
        occasion: form.occasion,
        tone: form.tone,
        locale: form.locale,
        memoryIds: [...form.memoryIds],
      });
      this.proposal.set(draft);
      this.proposalCount.update((count) => count + 1);
      void this.ensureLabels(draft.citedMemoryIds);
      this.live.announce('La propuesta está lista. No reemplaza tu texto.');
    } catch (error) {
      this.toasts.show(
        failureMessage(error, 'No pudimos escribir una propuesta. Inténtalo de nuevo.'),
        'err',
      );
    } finally {
      this.generating.set(false);
    }
  }

  protected useProposal(): void {
    const draft = this.proposal();
    if (draft === null) return;
    if (this.form().body.trim() !== '' && !this.confirmReplace()) {
      this.confirmReplace.set(true);
      return;
    }
    this.form.update((form) => applyProposal(form, draft));
    this.clearError('body');
    this.clearError('title');
    this.proposal.set(null);
    this.confirmReplace.set(false);
    this.toasts.show('Usamos la propuesta. Puedes editarla antes de guardar.');
  }

  protected discardProposal(): void {
    this.proposal.set(null);
    this.confirmReplace.set(false);
  }

  protected async saveDraft(): Promise<CardDto | null> {
    const recipient = this.recipient();
    if (this.saving() || recipient === null) return null;
    const form = this.form();
    const errors = validateCardForm(form);
    if (Object.keys(errors).length > 0) {
      this.errors.set(errors);
      this.live.announce('Revisa los campos marcados.');
      return null;
    }
    this.saving.set(true);
    try {
      const id = this.cardId();
      const common = {
        occasion: form.occasion,
        tone: form.tone,
        locale: form.locale,
        memoryIds: [...form.memoryIds],
        title: form.title,
        body: form.body,
        citedMemoryIds: [...form.citedMemoryIds],
      };
      const saved =
        id === null
          ? await this.api.create({
              ...common,
              recipientUserId: recipient.userId,
              clientRequestId: this.clientRequestId,
            })
          : await this.api.update(id, { ...common, version: this.version() });
      this.adopt(saved);
      this.store.saved(saved.cardId, saved.version, this.form());
      this.toasts.show('Tu borrador está guardado.');
      if (id === null) {
        this.cardId.set(saved.cardId);
        await this.router.navigate(['/app/cards', saved.cardId], { replaceUrl: true });
      }
      return saved;
    } catch (error) {
      this.toasts.show(
        failureMessage(error, 'No pudimos guardar el cambio. Tu texto sigue aquí.'),
        'err',
      );
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  protected async review(): Promise<void> {
    let id = this.cardId();
    if (id === null) {
      const saved = await this.saveDraft();
      if (saved === null) return;
      id = saved.cardId;
    }
    await this.router.navigate(['/app/cards', id, 'review']);
  }

  protected async deleteDraft(): Promise<void> {
    const id = this.cardId();
    if (id === null || this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.api.delete(id, this.version());
      this.store.clear();
      this.savedKey.set(null);
      this.form.set(emptyCardForm());
      this.panel.set(null);
      this.toasts.show('Eliminamos el borrador.');
      await this.router.navigateByUrl('/app/cards', { replaceUrl: true });
    } catch (error) {
      this.toasts.show(failureMessage(error, 'No pudimos eliminar el borrador.'), 'err');
    } finally {
      this.deleting.set(false);
    }
  }

  private adopt(card: CardDto): void {
    const form = cardFormFrom(card);
    this.version.set(card.version);
    this.form.set(form);
    this.savedKey.set(cardFormKey(form));
    this.errors.set({});
  }

  private clearError(field: CardField): void {
    if (this.errors()[field] === undefined) return;
    this.errors.update((errors) => {
      const next = { ...errors };
      delete next[field];
      return next;
    });
  }

  /** Loads titles for referenced memories that are not on the first timeline page. */
  private async ensureLabels(ids: readonly string[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.labels().has(id));
    const found = await Promise.all(
      missing.map((id) =>
        this.memoriesApi
          .get(id)
          .then(
            (memory) =>
              [id, { title: memory.title, date: formatShortDate(memory.occurredOn) }] as const,
          )
          .catch(() => null),
      ),
    );
    const labels = found.filter((entry) => entry !== null);
    if (labels.length) this.extraLabels.update((current) => new Map([...current, ...labels]));
  }
}
