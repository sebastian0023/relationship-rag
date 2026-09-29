import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CardDto } from '@relationship-rag/contracts';
import { supportReference } from './api/api-error.js';
import { CardsApiService } from './cards-api.service.js';
import { cardWhen, toneColor } from './cards/card-form.js';
import { LiveAnnouncer } from './ui/avisos.service.js';
import { EstadoComponent } from './ui/estado.component.js';
import { excerpt } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';
import { CARD_STATUS } from './ui/status.js';

const STAMP_ROTATIONS = ['rotate-[-6deg]', 'rotate-[4deg]', 'rotate-[-3deg]'];

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EstadoComponent, GatitosComponent, IconComponent, ListaEstadoComponent, RouterLink],
  template: `<div
    class="mx-auto box-border flex w-full flex-col gap-6 px-4 pb-8 pt-5 lg:max-w-[1040px] lg:px-12 lg:pb-16 lg:pt-9"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h1 class="m-0 font-titulo text-[32px] font-medium leading-[1.1]">Tarjetas</h1>
        <p class="m-0 text-[15px] leading-normal text-ciruela-suave">
          Lo que escribes para {{ partner() }}. Tus borradores solo los ves tú.
        </p>
      </div>
      <a routerLink="new" class="nh-btn nh-btn-primario px-[18px]"
        ><nh-icon name="plus" />Crear tarjeta</a
      >
    </div>

    @switch (state()) {
      @case ('loading') {
        <nh-lista-estado state="loading" loadingLabel="Cargando tus tarjetas…" />
      }
      @case ('error') {
        <nh-lista-estado
          state="error"
          errorTitle="No pudimos cargar tus tarjetas"
          errorMessage="Inténtalo de nuevo en un momento."
          [reference]="reference()"
          (retry)="reload()"
        />
      }
      @case ('empty') {
        <div class="flex flex-col items-center gap-3.5 px-2 py-5 text-center">
          <nh-gatitos name="envelope" />
          <h2 class="m-0 font-titulo text-2xl font-medium">
            Todavía no has escrito ninguna tarjeta
          </h2>
          <p class="m-0 max-w-[320px] text-[15px] leading-[1.55] text-ciruela-medio">
            Empieza un borrador; se guarda solo cuando tú lo decidas y nunca se envía sin tu
            confirmación.
          </p>
          <a routerLink="new" class="nh-btn nh-btn-primario px-[22px]">Crear tarjeta</a>
        </div>
      }
      @default {
        <ul class="m-0 grid list-none grid-cols-1 gap-3.5 p-0 lg:grid-cols-2">
          @for (card of cards(); track card.cardId; let index = $index) {
            <li>
              <a
                class="relative box-border flex h-full w-full flex-col gap-2 rounded-[14px] border border-borde bg-papel bg-[linear-gradient(135deg,transparent_0_calc(100%-26px),#F3ECE4_calc(100%-26px))] px-[18px] pb-4 pt-[18px] text-left text-ciruela no-underline shadow-[0_1px_2px_rgba(56,43,54,.05),0_6px_16px_rgba(56,43,54,.05)]"
                [routerLink]="card.status === 'DRAFT' ? [card.cardId] : [card.cardId, 'view']"
                [attr.aria-label]="'Abrir tarjeta ' + card.title + ', ' + statusLabel(card)"
              >
                <span
                  aria-hidden="true"
                  class="absolute right-3.5 top-3.5 flex h-12 w-10 items-center justify-center rounded border-2 border-dashed border-papel text-accion outline outline-1 outline-[#E2D3C6]"
                  [class]="stampRotation(index)"
                  [style.background]="stamp(card)"
                  ><nh-icon name="heart"
                /></span>
                <nh-estado [card]="card.status" />
                <h3 class="m-0 pr-14 font-titulo text-[21px] font-medium leading-[1.2]">
                  {{ card.title }}
                </h3>
                <p class="m-0 text-[13px] font-semibold text-ciruela-suave">
                  Para {{ card.recipientDisplayName }} · {{ when(card) }}
                </p>
                <p
                  class="m-0 line-clamp-3 whitespace-pre-line text-[15px] leading-[1.55] text-[#4B3C48]"
                  [textContent]="preview(card)"
                ></p>
              </a>
            </li>
          }
        </ul>
        <p class="m-0 text-[13.5px] leading-normal text-ciruela-suave">
          Las tarjetas programadas no aparecen en el buzón de {{ partner() }} hasta su fecha de
          entrega.
        </p>
        @if (nextCursor()) {
          <div class="flex justify-center">
            <button
              type="button"
              class="nh-btn nh-btn-secundario"
              [disabled]="loadingOlder()"
              (click)="loadOlder()"
            >
              @if (loadingOlder()) {
                <span class="nh-giro" aria-hidden="true"></span>Cargando…
              } @else {
                Cargar tarjetas anteriores
              }
            </button>
          </div>
        }
      }
    }
  </div>`,
})
export class CardListComponent {
  private readonly api = inject(CardsApiService);
  private readonly live = inject(LiveAnnouncer);
  protected readonly cards = signal<readonly CardDto[]>([]);
  protected readonly nextCursor = signal<string | undefined>(undefined);
  protected readonly state = signal<'loading' | 'error' | 'empty' | 'ready'>('loading');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly loadingOlder = signal(false);
  private readonly recipient = signal<string | null>(null);
  protected readonly partner = computed(
    () => this.recipient() ?? this.cards()[0]?.recipientDisplayName ?? 'tu pareja',
  );

  public constructor() {
    void this.reload();
    void this.api
      .recipients()
      .then((items) => this.recipient.set(items[0]?.displayName ?? null))
      .catch(() => undefined);
  }

  protected statusLabel(card: CardDto): string {
    return CARD_STATUS[card.status].label;
  }

  protected when(card: CardDto): string {
    return cardWhen(card);
  }

  protected stamp(card: CardDto): string {
    return toneColor(card.tone);
  }

  protected stampRotation(index: number): string {
    return STAMP_ROTATIONS[index % STAMP_ROTATIONS.length] ?? '';
  }

  protected preview(card: CardDto): string {
    return excerpt(card.body, 110);
  }

  protected async reload(): Promise<void> {
    this.state.set('loading');
    try {
      const page = await this.api.list();
      this.cards.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.state.set(page.items.length === 0 ? 'empty' : 'ready');
    } catch (error) {
      this.reference.set(supportReference(error));
      this.state.set('error');
    }
  }

  protected async loadOlder(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === undefined || this.loadingOlder()) return;
    this.loadingOlder.set(true);
    try {
      const page = await this.api.list(cursor);
      this.cards.update((cards) => [...cards, ...page.items]);
      this.nextCursor.set(page.nextCursor);
      this.live.announce('Se cargaron tarjetas anteriores');
    } catch {
      this.live.announce('No pudimos cargar más tarjetas. Inténtalo de nuevo.');
    } finally {
      this.loadingOlder.set(false);
    }
  }
}
