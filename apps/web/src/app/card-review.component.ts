import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CardDto } from '@relationship-rag/contracts';
import { failureMessage, isConflict, isNotFound, supportReference } from './api/api-error.js';
import { CardsApiService } from './cards-api.service.js';
import { CardDraftStore } from './cards/card-draft-store.service.js';
import { isCardFormDirty, validateCardForm } from './cards/card-form.js';
import { scheduleInstant, timeZoneLabel } from './cards/schedule.js';
import { MemoriesApiService } from './memories-api.service.js';
import { LiveAnnouncer, ToastService } from './ui/avisos.service.js';
import { formatInstantWithTime, formatShortDate } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';

type Mode = 'now' | 'schedule';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent, IconComponent, ListaEstadoComponent, RouterLink],
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
        @if (card(); as saved) {
          <div class="flex flex-col">
            <div class="nh-barra-superior justify-start">
              <a [routerLink]="['/app/cards', saved.cardId]" class="nh-btn nh-btn-texto gap-1"
                ><nh-icon name="back" />Volver a editar</a
              >
            </div>
            <div
              class="mx-auto box-border flex w-full max-w-[680px] flex-col gap-[22px] px-4 pb-8 pt-5 lg:px-12 lg:pb-16 lg:pt-9"
            >
              <h1 class="m-0 font-titulo text-[30px] font-medium leading-[1.15]">
                Revisa antes de enviar
              </h1>
              @if (dirty()) {
                <div
                  role="alert"
                  class="flex flex-col gap-3 rounded-[14px] bg-[#F7E9D6] p-4 text-[#6A4A1E]"
                >
                  <p class="m-0 flex gap-2 text-[15px] font-semibold leading-[1.45]">
                    <nh-icon name="alert" />Tienes cambios sin guardar.
                  </p>
                  <p class="m-0 text-[14.5px] leading-normal">
                    Solo se envía la versión guardada. Guarda tus cambios o vuelve a editar antes de
                    confirmar.
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="nh-btn nh-btn-oscuro min-h-11 px-4 text-sm"
                      [disabled]="savingChanges()"
                      (click)="saveChanges()"
                    >
                      {{ savingChanges() ? 'Guardando…' : 'Guardar cambios y continuar' }}
                    </button>
                    <a
                      [routerLink]="['/app/cards', saved.cardId]"
                      class="nh-btn min-h-11 border-[1.5px] border-[#CFAE86] bg-transparent px-3.5 text-sm text-[#6A4A1E]"
                      >Volver a editar</a
                    >
                  </div>
                </div>
              }
              <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
                <dt class="font-semibold text-ciruela-suave">Para</dt>
                <dd class="m-0 font-semibold">{{ saved.recipientDisplayName }}</dd>
                <dt class="font-semibold text-ciruela-suave">Título</dt>
                <dd class="m-0">{{ saved.title }}</dd>
              </dl>
              <div
                class="rounded-md bg-papel bg-[repeating-linear-gradient(transparent_0_29px,#F3E9DF_29px_30px)] px-6 py-[26px] shadow-[0_2px_6px_rgba(56,43,54,.08)]"
              >
                <p
                  class="m-0 whitespace-pre-wrap font-titulo text-[17px] leading-[30px]"
                  [textContent]="saved.body"
                ></p>
              </div>
              @if (saved.citedMemoryIds.length) {
                <div class="flex flex-col gap-1.5">
                  <span class="text-sm font-semibold text-ciruela-suave">Recuerdos de apoyo</span>
                  <ul class="m-0 flex list-none flex-wrap gap-1.5 p-0">
                    @for (id of saved.citedMemoryIds; track id) {
                      <li class="rounded-full bg-salvia px-3 py-1.5 text-sm font-medium">
                        {{ labelOf(id) }}
                      </li>
                    }
                  </ul>
                </div>
              }
              <fieldset class="m-0 flex flex-col gap-2.5 border-0 p-0">
                <legend class="mb-2.5 p-0 text-base font-semibold">¿Cuándo debe llegar?</legend>
                @for (option of modes(); track option.value) {
                  <label
                    class="nh-foco-interno flex min-h-[60px] cursor-pointer items-center gap-3 rounded-[14px] border-[1.5px] px-3.5 py-2.5"
                    [class]="
                      mode() === option.value
                        ? 'border-accion bg-[#FBEFEE]'
                        : 'border-campo bg-papel'
                    "
                  >
                    <input
                      type="radio"
                      name="rv-mode"
                      class="sr-only"
                      [checked]="mode() === option.value"
                      (change)="setMode(option.value)"
                    />
                    <span
                      aria-hidden="true"
                      class="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-ciruela"
                      ><span
                        class="size-2.5 rounded-full"
                        [class.bg-accion]="mode() === option.value"
                      ></span
                    ></span>
                    <span class="flex flex-col gap-0.5">
                      <span class="text-base font-semibold">{{ option.label }}</span>
                      <span class="text-sm text-ciruela-suave">{{ option.description }}</span>
                    </span>
                  </label>
                }
              </fieldset>
              @if (mode() === 'schedule') {
                <div class="flex flex-col gap-3 rounded-[14px] border border-borde bg-papel p-4">
                  <div class="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
                    <div class="flex flex-col gap-1.5">
                      <label for="rv-date" class="nh-etiqueta-campo">Fecha</label>
                      <input
                        id="rv-date"
                        type="date"
                        class="nh-campo"
                        [value]="date()"
                        [attr.aria-invalid]="!!scheduleError()"
                        [attr.aria-describedby]="scheduleError() ? 'rv-error' : null"
                        (input)="setDate($event)"
                      />
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label for="rv-time" class="nh-etiqueta-campo">Hora</label>
                      <input
                        id="rv-time"
                        type="time"
                        class="nh-campo"
                        [value]="time()"
                        [attr.aria-invalid]="!!scheduleError()"
                        [attr.aria-describedby]="scheduleError() ? 'rv-error' : null"
                        (input)="setTime($event)"
                      />
                    </div>
                  </div>
                  <p class="m-0 flex gap-2 text-sm font-medium leading-[1.45] text-ciruela-medio">
                    <nh-icon name="clock" />Zona horaria: {{ zone }}
                  </p>
                  <p class="m-0 text-[13.5px] leading-normal text-ciruela-suave">
                    La tarjeta llegará a partir del minuto que elijas, no antes.
                  </p>
                  @if (summary(); as text) {
                    <p
                      role="status"
                      class="m-0 rounded-[10px] bg-[#E3ECE0] px-3 py-2.5 text-[14.5px] font-semibold leading-[1.45] text-[#2F5236]"
                    >
                      {{ text }}
                    </p>
                  }
                  @if (scheduleError(); as error) {
                    <p id="rv-error" role="alert" class="nh-error-campo">
                      <nh-icon name="alert" />{{ error }}
                    </p>
                  }
                </div>
              }
              <div
                class="flex gap-2.5 rounded-[14px] bg-arena px-4 py-3.5 text-[15px] font-medium leading-normal"
              >
                <nh-icon name="lock" /><span
                  >Después de confirmar, esta tarjeta no se podrá editar, cancelar ni
                  reprogramar.</span
                >
              </div>
              <div class="flex flex-col gap-2">
                <button
                  type="button"
                  class="nh-btn nh-btn-primario min-h-[52px] gap-2.5 text-base"
                  [disabled]="confirmDisabled()"
                  (click)="confirm()"
                >
                  @if (confirming()) {
                    <span class="nh-giro" aria-hidden="true"></span>Confirmando…
                  } @else {
                    {{ mode() === 'schedule' ? 'Confirmar programación' : 'Confirmar envío' }}
                  }
                </button>
                <a [routerLink]="['/app/cards', saved.cardId]" class="nh-btn nh-btn-secundario"
                  >Volver a editar</a
                >
              </div>
            </div>
          </div>
        }
      }
    }
  `,
})
export class CardReviewComponent {
  private readonly api = inject(CardsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(CardDraftStore);
  private readonly toasts = inject(ToastService);
  private readonly live = inject(LiveAnnouncer);

  private readonly cardId = this.route.snapshot.paramMap.get('cardId') ?? '';
  protected readonly zone = timeZoneLabel();
  protected readonly card = signal<CardDto | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly mode = signal<Mode>('now');
  protected readonly date = signal('');
  protected readonly time = signal('');
  protected readonly scheduleError = signal<string | null>(null);
  protected readonly confirming = signal(false);
  protected readonly savingChanges = signal(false);
  private readonly labels = signal<ReadonlyMap<string, string>>(new Map());
  /** One key per confirmation payload: a retry of the same request can never send twice. */
  private attempt: { payload: string; key: string } | null = null;

  protected readonly dirty = computed(() => {
    const buffer = this.store.current();
    return (
      buffer !== null &&
      buffer.cardId === this.cardId &&
      isCardFormDirty(buffer.form, buffer.savedKey)
    );
  });
  protected readonly confirmDisabled = computed(
    () => this.confirming() || this.dirty() || this.card() === null,
  );
  protected readonly modes = computed(() => [
    {
      value: 'now' as const,
      label: 'Enviar ahora',
      description: `Llega al buzón de ${this.card()?.recipientDisplayName ?? 'tu pareja'} en unos momentos.`,
    },
    {
      value: 'schedule' as const,
      label: 'Programar entrega',
      description: 'Elige fecha y hora de entrega.',
    },
  ]);
  protected readonly summary = computed(() => {
    if (this.mode() !== 'schedule') return null;
    const result = scheduleInstant(this.date(), this.time(), new Date());
    return result.ok
      ? `Llegará a partir del ${formatInstantWithTime(result.instant)} (tu hora local).`
      : null;
  });

  public constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const card = await this.api.get(this.cardId);
      if (card.status !== 'DRAFT') {
        await this.router.navigate(['/app/cards', card.cardId, 'view'], { replaceUrl: true });
        return;
      }
      const buffer = this.store.forCard(card.cardId);
      if (buffer !== null && buffer.version !== card.version) this.store.clear();
      this.card.set(card);
      this.state.set('ready');
      void this.loadLabels(card.citedMemoryIds);
    } catch (error) {
      this.reference.set(supportReference(error));
      this.state.set(isNotFound(error) ? 'missing' : 'error');
    }
  }

  protected labelOf(memoryId: string): string {
    return this.labels().get(memoryId) ?? 'Recuerdo';
  }

  protected setMode(mode: Mode): void {
    this.mode.set(mode);
    this.scheduleError.set(null);
  }

  protected setDate(event: Event): void {
    this.date.set((event.target as HTMLInputElement).value);
    this.scheduleError.set(null);
  }

  protected setTime(event: Event): void {
    this.time.set((event.target as HTMLInputElement).value);
    this.scheduleError.set(null);
  }

  protected async saveChanges(): Promise<void> {
    const buffer = this.store.forCard(this.cardId);
    if (buffer === null || this.savingChanges()) return;
    if (Object.keys(validateCardForm(buffer.form)).length > 0) {
      this.toasts.show('Vuelve a editar: hay campos por revisar antes de guardar.', 'err');
      return;
    }
    this.savingChanges.set(true);
    try {
      const saved = await this.api.update(this.cardId, {
        version: buffer.version,
        occasion: buffer.form.occasion,
        tone: buffer.form.tone,
        locale: buffer.form.locale,
        memoryIds: [...buffer.form.memoryIds],
        title: buffer.form.title,
        body: buffer.form.body,
        citedMemoryIds: [...buffer.form.citedMemoryIds],
      });
      this.store.saved(saved.cardId, saved.version, buffer.form);
      this.card.set(saved);
      this.toasts.show('Guardamos tus cambios.');
    } catch (error) {
      this.toasts.show(
        failureMessage(error, 'No pudimos guardar el cambio. Tu texto sigue aquí.'),
        'err',
      );
    } finally {
      this.savingChanges.set(false);
    }
  }

  protected async confirm(): Promise<void> {
    const card = this.card();
    if (card === null || this.confirmDisabled()) return;
    let deliveryAt: string | undefined;
    if (this.mode() === 'schedule') {
      const result = scheduleInstant(this.date(), this.time(), new Date());
      if (!result.ok) {
        this.scheduleError.set(result.error);
        this.live.announce(result.error);
        return;
      }
      deliveryAt = result.instant;
    }
    const payload = JSON.stringify([card.version, deliveryAt ?? null]);
    if (this.attempt?.payload !== payload) this.attempt = { payload, key: crypto.randomUUID() };
    this.confirming.set(true);
    try {
      await this.api.send(card.cardId, {
        confirmed: true,
        version: card.version,
        idempotencyKey: this.attempt.key,
        ...(deliveryAt === undefined ? {} : { deliveryAt }),
      });
      this.store.clear();
      await this.router.navigate(['/app/cards', card.cardId, 'view'], {
        queryParams: { confirmed: 1 },
        replaceUrl: true,
      });
    } catch (error) {
      if (isConflict(error)) {
        this.toasts.show(
          'La tarjeta cambió. Revisa la versión guardada antes de confirmar.',
          'err',
        );
        await this.load();
      } else {
        this.toasts.show(
          failureMessage(
            error,
            'No pudimos confirmar el envío. Puedes reintentar; no se enviará dos veces.',
          ),
          'err',
        );
      }
    } finally {
      this.confirming.set(false);
    }
  }

  private async loadLabels(ids: readonly string[]): Promise<void> {
    const entries = await Promise.all(
      ids.map((id) =>
        this.memoriesApi
          .get(id)
          .then(
            (memory) => [id, `${memory.title} · ${formatShortDate(memory.occurredOn)}`] as const,
          )
          .catch(() => [id, 'Recuerdo no disponible'] as const),
      ),
    );
    this.labels.set(new Map(entries));
  }
}
