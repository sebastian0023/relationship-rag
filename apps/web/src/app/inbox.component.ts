import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { InboxItem } from '@relationship-rag/contracts';
import { supportReference } from './api/api-error.js';
import { CardsApiService } from './cards-api.service.js';
import { InboxState } from './inbox-state.service.js';
import { LiveAnnouncer } from './ui/avisos.service.js';
import { formatLongInstant } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent, IconComponent, ListaEstadoComponent, RouterLink],
  template: `<div
    class="mx-auto box-border flex w-full max-w-[760px] flex-col gap-[22px] px-4 pb-8 pt-5 lg:px-12 lg:pb-16 lg:pt-9"
  >
    <div class="flex flex-col gap-1">
      <h1 class="m-0 font-titulo text-[32px] font-medium leading-[1.1]">Buzón</h1>
      <p class="m-0 text-[15px] leading-normal text-ciruela-suave">
        Las tarjetas que {{ partner() }} te escribió.
        @if (unread() > 0) {
          <b class="text-accion">{{ unread() === 1 ? '1 sin leer' : unread() + ' sin leer' }}</b>
        }
      </p>
    </div>
    @switch (state()) {
      @case ('loading') {
        <nh-lista-estado state="loading" loadingLabel="Revisando el buzón…" />
      }
      @case ('error') {
        <nh-lista-estado
          state="error"
          errorTitle="No pudimos abrir el buzón"
          [reference]="reference()"
          (retry)="reload()"
        />
      }
      @case ('empty') {
        <div class="flex flex-col items-center gap-3.5 px-2 py-5 text-center">
          <nh-gatitos name="envelope" />
          <h2 class="m-0 font-titulo text-[26px] font-medium">Todavía no hay cartas por aquí.</h2>
          <p class="m-0 max-w-[300px] text-[15px] leading-[1.55] text-ciruela-medio">
            Cuando {{ partner() }} te envíe una tarjeta, aparecerá en este buzón.
          </p>
        </div>
      }
      @default {
        <ul class="m-0 flex list-none flex-col gap-2.5 p-0">
          @for (item of items(); track item.cardId) {
            <li>
              <a
                [routerLink]="item.cardId"
                [attr.aria-label]="ariaFor(item)"
                class="box-border flex w-full items-center gap-3.5 rounded-[14px] border-[1.5px] p-3.5 text-left text-ciruela no-underline"
                [class]="
                  item.readAt === undefined
                    ? 'border-[#E9B9B6] bg-[#FFF4F2]'
                    : 'border-borde bg-papel'
                "
              >
                <span
                  aria-hidden="true"
                  class="relative h-10 w-[54px] shrink-0 overflow-hidden rounded-[5px] border-[1.5px] border-ciruela bg-durazno"
                  ><span
                    class="absolute -left-0.5 -right-0.5 -top-[22px] h-10 border-b-[1.5px] border-ciruela bg-[#EDC39A] [clip-path:polygon(0_50%,100%_50%,50%_100%)]"
                  ></span>
                  @if (item.readAt === undefined) {
                    <span
                      class="absolute left-[19px] top-[13px] size-3.5 rounded-full bg-accion"
                    ></span>
                  }
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span
                    class="font-titulo text-[17px] leading-[1.3]"
                    [class]="item.readAt === undefined ? 'font-bold' : 'font-medium'"
                    >{{ item.title }}</span
                  >
                  <span class="text-[13.5px] font-medium text-ciruela-suave"
                    >De {{ item.senderDisplayName }} · {{ delivered(item) }}</span
                  >
                </span>
                @if (item.readAt === undefined) {
                  <span
                    aria-hidden="true"
                    class="rounded-full bg-accion px-[9px] py-[3px] text-xs font-bold text-papel"
                    >Sin leer</span
                  >
                }
                <span class="text-ciruela-suave"><nh-icon name="fwd" /></span>
              </a>
            </li>
          }
        </ul>
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
                Ver tarjetas anteriores
              }
            </button>
          </div>
        }
      }
    }
  </div>`,
})
export class InboxComponent {
  private readonly api = inject(CardsApiService);
  private readonly inboxState = inject(InboxState);
  private readonly live = inject(LiveAnnouncer);
  protected readonly items = signal<readonly InboxItem[]>([]);
  protected readonly nextCursor = signal<string | undefined>(undefined);
  protected readonly state = signal<'loading' | 'error' | 'empty' | 'ready'>('loading');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly loadingOlder = signal(false);
  private readonly recipient = signal<string | null>(null);
  protected readonly unread = computed(
    () => this.items().filter((item) => item.readAt === undefined).length,
  );
  protected readonly partner = computed(
    () => this.items()[0]?.senderDisplayName ?? this.recipient() ?? 'tu pareja',
  );

  public constructor() {
    void this.reload();
    void this.api
      .recipients()
      .then((items) => this.recipient.set(items[0]?.displayName ?? null))
      .catch(() => undefined);
  }

  protected delivered(item: InboxItem): string {
    return formatLongInstant(item.deliveredAt);
  }

  protected ariaFor(item: InboxItem): string {
    return `${item.readAt === undefined ? 'Sin leer. ' : ''}Tarjeta de ${item.senderDisplayName}: ${item.title}, entregada el ${this.delivered(item)}`;
  }

  protected async reload(): Promise<void> {
    this.state.set('loading');
    try {
      const page = await this.api.inbox();
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.inboxState.unread.set(this.unread());
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
      const page = await this.api.inbox(cursor);
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
      this.live.announce('Se cargaron tarjetas anteriores');
    } catch {
      this.live.announce('No pudimos cargar más tarjetas. Inténtalo de nuevo.');
    } finally {
      this.loadingOlder.set(false);
    }
  }
}
