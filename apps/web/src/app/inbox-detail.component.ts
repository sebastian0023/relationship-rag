import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { InboxItem } from '@relationship-rag/contracts';
import { isNotFound, supportReference } from './api/api-error.js';
import { CardsApiService } from './cards-api.service.js';
import { InboxState } from './inbox-state.service.js';
import { MemoriesApiService } from './memories-api.service.js';
import { LiveAnnouncer } from './ui/avisos.service.js';
import { formatLongInstant, formatShortDate } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';
import { prefersReducedMotion } from './ui/platform.service.js';
import { SobreComponent } from './ui/sobre.component.js';

const OPENING_MS = 1500;

interface RelatedMemory {
  readonly id: string;
  readonly title: string;
  readonly date: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent, IconComponent, ListaEstadoComponent, RouterLink, SobreComponent],
  template: `
    @switch (state()) {
      @case ('loading') {
        <div role="status" aria-busy="true" class="px-4 py-8 text-[15px] text-ciruela-suave">
          Abriendo el buzón…
        </div>
      }
      @case ('missing') {
        <div class="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <nh-gatitos name="envelope" />
          <h1 class="m-0 font-titulo text-[26px] font-medium leading-[1.2]">
            Esta tarjeta ya no está disponible
          </h1>
          <a routerLink="/app/inbox" class="nh-btn nh-btn-primario px-[22px]">Ir al buzón</a>
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
        @if (item(); as letter) {
          <article class="flex flex-col" aria-labelledby="carta-titulo">
            <div class="nh-barra-superior">
              <a routerLink="/app/inbox" class="nh-btn nh-btn-texto gap-1"
                ><nh-icon name="back" />Buzón</a
              >
              @if (opening()) {
                <button
                  type="button"
                  class="nh-btn nh-btn-secundario min-h-11 px-3.5 text-sm"
                  (click)="finishOpening()"
                >
                  Saltar animación
                </button>
              }
            </div>
            @if (opening()) {
              <div class="flex flex-col items-center gap-[18px] px-5 py-[60px]">
                <nh-sobre />
                <p class="m-0 font-titulo text-[17px] italic text-ciruela-medio">
                  Abriendo la tarjeta de {{ letter.senderDisplayName }}…
                </p>
              </div>
            } @else {
              <div
                class="mx-auto box-border flex w-full max-w-[680px] flex-col gap-[18px] px-4 pb-8 pt-5 lg:px-12 lg:pb-16 lg:pt-9"
              >
                <div
                  class="relative flex flex-col gap-3.5 rounded-md bg-papel bg-[repeating-linear-gradient(transparent_0_31px,#F3E9DF_31px_32px)] px-[26px] pb-[30px] pt-[34px] shadow-[0_2px_6px_rgba(56,43,54,.08),0_18px_40px_rgba(56,43,54,.10)]"
                >
                  <span
                    aria-hidden="true"
                    class="absolute -top-2.5 right-[26px] h-[22px] w-20 rotate-[4deg] rounded-sm bg-[rgba(231,222,242,.9)]"
                  ></span>
                  <p class="m-0 text-[13.5px] font-semibold text-ciruela-suave">
                    De {{ letter.senderDisplayName }} · entregada el {{ deliveredOn() }}
                  </p>
                  <h1
                    id="carta-titulo"
                    class="m-0 text-balance font-titulo text-[30px] font-medium leading-[1.2]"
                  >
                    {{ letter.title }}
                  </h1>
                  <p
                    class="m-0 max-w-[60ch] whitespace-pre-wrap font-titulo text-lg leading-8"
                    [textContent]="letter.body"
                  ></p>
                </div>
                @if (related().length) {
                  <div class="flex flex-col gap-2">
                    <span class="text-sm font-semibold text-ciruela-suave"
                      >Recuerdos relacionados</span
                    >
                    <div class="flex flex-wrap gap-1.5">
                      @for (memory of related(); track memory.id) {
                        <a
                          class="flex min-h-11 items-center gap-1.5 rounded-full border border-campo bg-papel px-3.5 text-sm font-semibold text-accion no-underline"
                          [routerLink]="['/app/timeline', memory.id]"
                          [queryParams]="{ from: '/app/inbox/' + letter.cardId }"
                          ><nh-icon name="album" [size]="18" />{{ memory.title }}
                          @if (memory.date) {
                            <span class="font-medium text-ciruela-suave">· {{ memory.date }}</span>
                          }
                        </a>
                      }
                    </div>
                  </div>
                }
                <a
                  routerLink="/app/inbox"
                  class="nh-btn nh-btn-secundario gap-1.5 self-start px-[18px]"
                  ><nh-icon name="back" />Volver al buzón</a
                >
              </div>
            }
          </article>
        }
      }
    }
  `,
})
export class InboxDetailComponent {
  private readonly api = inject(CardsApiService);
  private readonly memoriesApi = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly inboxState = inject(InboxState);
  private readonly live = inject(LiveAnnouncer);

  private readonly cardId = this.route.snapshot.paramMap.get('cardId') ?? '';
  protected readonly item = signal<InboxItem | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly opening = signal(false);
  protected readonly related = signal<readonly RelatedMemory[]>([]);
  private openingTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly deliveredOn = computed(() => {
    const item = this.item();
    return item === null ? '' : formatLongInstant(item.deliveredAt);
  });

  public constructor() {
    void this.load();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.openingTimer));
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const item = await this.api.inboxItem(this.cardId);
      this.item.set(item);
      this.state.set('ready');
      if (!prefersReducedMotion()) {
        this.opening.set(true);
        this.openingTimer = setTimeout(() => this.finishOpening(), OPENING_MS);
      }
      if (item.readAt === undefined) {
        this.item.set(await this.api.markRead(this.cardId));
        this.inboxState.markedRead();
        this.live.announce('Tarjeta abierta y marcada como leída.');
      }
      void this.loadRelated(item.citedMemoryIds);
    } catch (error) {
      this.reference.set(supportReference(error));
      if (this.item() === null) this.state.set(isNotFound(error) ? 'missing' : 'error');
    }
  }

  protected finishOpening(): void {
    clearTimeout(this.openingTimer);
    this.opening.set(false);
  }

  private async loadRelated(ids: readonly string[]): Promise<void> {
    const memories = await Promise.all(
      ids.map((id) =>
        this.memoriesApi
          .get(id)
          .then((memory) => ({ id, title: memory.title, date: formatShortDate(memory.occurredOn) }))
          .catch(() => ({ id, title: 'Ver recuerdo', date: '' })),
      ),
    );
    this.related.set(memories);
  }
}
