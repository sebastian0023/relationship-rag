import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CardDto } from '@relationship-rag/contracts';
import { isNotFound, supportReference } from './api/api-error.js';
import { CardsApiService } from './cards-api.service.js';
import { cardWhen } from './cards/card-form.js';
import { MemoriesApiService } from './memories-api.service.js';
import { LiveAnnouncer, ToastService } from './ui/avisos.service.js';
import { EstadoComponent } from './ui/estado.component.js';
import { formatInstantWithTime } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';
import { isCardInFlight } from './ui/status.js';

const POLL_MS = 3000;
const MAX_POLLS = 40;

/** A confirmed card: the delivery result right after confirming, or the read-only card later. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EstadoComponent, GatitosComponent, IconComponent, ListaEstadoComponent, RouterLink],
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
        @if (card(); as item) {
          @if (confirmed()) {
            <div
              class="mx-auto flex max-w-[560px] flex-col items-center gap-4 px-5 py-9 text-center"
            >
              <nh-gatitos name="envelope" />
              <div aria-live="polite"><nh-estado [card]="item.status" [large]="true" /></div>
              @switch (item.status) {
                @case ('QUEUED') {
                  <h1 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">
                    Tu tarjeta está en camino
                  </h1>
                  <p class="m-0 text-base leading-[1.55] text-ciruela-medio">
                    Está en cola y aparecerá en el buzón de {{ item.recipientDisplayName }} en unos
                    momentos. Aquí verás cuando se haya enviado.
                  </p>
                }
                @case ('SENT') {
                  <h1 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">
                    Tu tarjeta se envió
                  </h1>
                  <p class="m-0 text-base leading-[1.55] text-ciruela-medio">
                    Ya está en el buzón de {{ item.recipientDisplayName }}.
                  </p>
                }
                @case ('SCHEDULED') {
                  <h1 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">
                    Tarjeta programada
                  </h1>
                  <p class="m-0 text-base leading-[1.55] text-ciruela-medio">
                    Llegará a partir del {{ deliveryLabel() }} (tu hora local).
                    {{ item.recipientDisplayName }} no la verá antes.
                  </p>
                }
                @default {
                  <h1 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">
                    No pudimos entregar la tarjeta
                  </h1>
                  <p class="m-0 text-base leading-[1.55] text-ciruela-medio">
                    Las tarjetas confirmadas no se pueden reenviar. Puedes copiar el mensaje y crear
                    una tarjeta nueva.
                  </p>
                }
              }
              <p class="m-0 text-[15px] font-medium">«{{ item.title }}»</p>
              <div class="flex flex-wrap justify-center gap-2">
                <a routerLink="/app/cards" class="nh-btn nh-btn-primario px-[22px]"
                  >Volver a Tarjetas</a
                >
                <a
                  [routerLink]="['/app/cards', item.cardId, 'view']"
                  class="nh-btn nh-btn-secundario"
                  >Ver la tarjeta</a
                >
              </div>
            </div>
          } @else {
            <div class="flex flex-col">
              <div class="nh-barra-superior justify-start">
                <a routerLink="/app/cards" class="nh-btn nh-btn-texto gap-1"
                  ><nh-icon name="back" />Tarjetas</a
                >
              </div>
              <div
                class="mx-auto box-border flex w-full max-w-[680px] flex-col gap-[18px] px-4 pb-8 pt-5 lg:px-12 lg:pb-16 lg:pt-9"
              >
                <div aria-live="polite" class="flex">
                  <nh-estado [card]="item.status" [large]="true" />
                </div>
                <p class="m-0 text-sm font-medium text-ciruela-suave">
                  Para {{ item.recipientDisplayName }} · {{ when() }}
                </p>
                @if (item.status === 'DELIVERY_FAILED') {
                  <div
                    role="alert"
                    class="flex flex-col gap-2 rounded-[14px] border border-[#E9B1AA] bg-[#FFF1EF] p-4 text-[#8A2B25]"
                  >
                    <p class="m-0 flex gap-2 text-[15px] font-semibold leading-[1.45]">
                      <nh-icon name="alert" />No pudimos entregar esta tarjeta.
                    </p>
                    <p class="m-0 text-[14.5px] leading-normal text-[#5B2A26]">
                      {{ item.recipientDisplayName }} no la recibió. Las tarjetas confirmadas no se
                      pueden reenviar; si quieres, copia el mensaje y crea una tarjeta nueva.
                    </p>
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="nh-btn min-h-11 gap-1.5 border-[1.5px] border-[#D9A7A0] bg-papel px-3.5 text-sm text-ciruela"
                        (click)="copyMessage(item.body)"
                      >
                        <nh-icon name="copy" />Copiar mensaje
                      </button>
                      <a
                        routerLink="/app/cards/new"
                        class="nh-btn nh-btn-primario min-h-11 px-3.5 text-sm"
                        >Crear tarjeta nueva</a
                      >
                    </div>
                  </div>
                }
                @if (item.status === 'SCHEDULED') {
                  <p
                    class="m-0 rounded-xl bg-[#E3ECE0] px-3.5 py-3 text-[14.5px] font-medium leading-normal text-[#2F5236]"
                  >
                    Llegará a partir del {{ deliveryLabel() }} (tu hora local). Ya no se puede
                    editar, cancelar ni reprogramar.
                  </p>
                }
                <div
                  class="flex flex-col gap-3 rounded-md bg-papel bg-[repeating-linear-gradient(transparent_0_29px,#F3E9DF_29px_30px)] px-[26px] py-[30px] shadow-[0_2px_6px_rgba(56,43,54,.08),0_14px_30px_rgba(56,43,54,.08)]"
                >
                  <h1 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">
                    {{ item.title }}
                  </h1>
                  <p
                    class="m-0 whitespace-pre-wrap font-titulo text-[17px] leading-[30px]"
                    [textContent]="item.body"
                  ></p>
                </div>
                @if (item.citedMemoryIds.length) {
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-sm font-semibold text-ciruela-suave"
                      >Recuerdos relacionados:</span
                    >
                    @for (id of item.citedMemoryIds; track id) {
                      <a
                        class="flex min-h-10 items-center rounded-full border border-campo bg-papel px-3 text-sm font-semibold text-accion underline"
                        [routerLink]="['/app/timeline', id]"
                        [queryParams]="{ from: '/app/cards/' + item.cardId + '/view' }"
                        >{{ labels().get(id) ?? 'Ver recuerdo' }}</a
                      >
                    }
                  </div>
                }
              </div>
            </div>
          }
        }
      }
    }
  `,
})
export class CardViewComponent {
  private readonly api = inject(CardsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly live = inject(LiveAnnouncer);

  private readonly cardId = this.route.snapshot.paramMap.get('cardId') ?? '';
  protected readonly confirmed = signal(this.route.snapshot.queryParamMap.get('confirmed') === '1');
  protected readonly card = signal<CardDto | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly labels = signal<ReadonlyMap<string, string>>(new Map());
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private polls = 0;

  protected readonly when = computed(() => {
    const card = this.card();
    return card === null ? '' : cardWhen(card);
  });
  protected readonly deliveryLabel = computed(() => {
    const deliveryAt = this.card()?.deliveryAt;
    return deliveryAt === undefined ? '' : formatInstantWithTime(deliveryAt);
  });

  public constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => this.confirmed.set(params.get('confirmed') === '1'));
    void this.load();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const card = await this.api.get(this.cardId);
      if (card.status === 'DRAFT') {
        await this.router.navigate(['/app/cards', card.cardId], { replaceUrl: true });
        return;
      }
      this.card.set(card);
      this.state.set('ready');
      void this.loadLabels(card.citedMemoryIds);
      this.schedulePoll();
    } catch (error) {
      this.reference.set(supportReference(error));
      this.state.set(isNotFound(error) ? 'missing' : 'error');
    }
  }

  protected async copyMessage(body: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(body);
      this.toasts.show('Copiamos el mensaje.');
    } catch {
      this.toasts.show('No pudimos copiar el mensaje.', 'err');
    }
  }

  /** While queued, asks the server again; the screen only ever shows the server's status. */
  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    const card = this.card();
    if (card === null || !isCardInFlight(card.status) || this.polls >= MAX_POLLS) return;
    this.pollTimer = setTimeout(async () => {
      this.polls += 1;
      try {
        const next = await this.api.get(this.cardId);
        this.card.set(next);
        if (next.status === 'SENT') this.live.announce('Tu tarjeta fue enviada.');
        if (next.status === 'DELIVERY_FAILED')
          this.live.announce('No pudimos entregar la tarjeta.');
      } catch {
        /* Keep the last known status; the next poll may succeed. */
      }
      this.schedulePoll();
    }, POLL_MS);
  }

  private async loadLabels(ids: readonly string[]): Promise<void> {
    const entries = await Promise.all(
      ids.map((id) =>
        this.memoriesApi
          .get(id)
          .then((memory) => [id, memory.title] as const)
          .catch(() => null),
      ),
    );
    this.labels.set(new Map(entries.filter((entry) => entry !== null)));
  }
}
