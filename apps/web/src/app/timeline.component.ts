import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { MemoryDto } from '@relationship-rag/contracts';
import { supportReference } from './api/api-error.js';
import { MemoriesApiService } from './memories-api.service.js';
import { LiveAnnouncer } from './ui/avisos.service.js';
import { EstadoComponent } from './ui/estado.component.js';
import { countLabel, excerpt, formatLongDate, monthGroupLabel } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';

interface TimelineItem {
  readonly memory: MemoryDto;
  readonly index: number;
  readonly date: string;
  readonly excerpt: string;
  readonly cover: string | undefined;
  readonly morePhotos: number;
}

interface TimelineGroup {
  readonly key: string;
  readonly label: string;
  readonly count: string;
  readonly items: readonly TimelineItem[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EstadoComponent, GatitosComponent, IconComponent, ListaEstadoComponent, RouterLink],
  template: `<div
    class="mx-auto box-border flex w-full flex-col gap-[26px] px-4 pb-8 pt-5 lg:max-w-[1040px] lg:px-12 lg:pb-16 lg:pt-9"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex flex-col gap-1">
        <h1 class="m-0 font-titulo text-[32px] font-medium leading-[1.1]">Recuerdos</h1>
        <p class="m-0 text-[15px] leading-normal text-ciruela-suave">
          Su álbum, del más reciente al más antiguo.
        </p>
      </div>
      <a routerLink="new" class="nh-btn nh-btn-primario px-[18px]"
        ><nh-icon name="plus" />Añadir recuerdo</a
      >
    </div>

    @switch (state()) {
      @case ('loading') {
        <div role="status" aria-busy="true" class="flex flex-col gap-[18px]">
          <span class="text-[15px] font-medium text-ciruela-suave">Cargando sus recuerdos…</span>
          <div class="flex flex-col gap-3 rounded-2xl bg-papel p-3.5">
            <div class="aspect-[4/3] rounded-[10px] bg-[#F1E8DE]"></div>
            <div class="h-3.5 w-2/5 rounded-md bg-[#F1E8DE]"></div>
            <div class="h-5 w-3/4 rounded-md bg-[#EDE2D6]"></div>
            <div class="h-3.5 w-[90%] rounded-md bg-[#F1E8DE]"></div>
          </div>
        </div>
      }
      @case ('error') {
        <nh-lista-estado
          state="error"
          errorTitle="No pudimos cargar sus recuerdos"
          [reference]="reference()"
          (retry)="reload()"
        />
      }
      @case ('empty') {
        <div class="flex flex-col items-center gap-4 px-2 py-6 text-center">
          <nh-gatitos name="empty" />
          <h2 class="m-0 text-balance font-titulo text-[26px] font-medium leading-[1.2]">
            Nuestra historia empieza con un recuerdo.
          </h2>
          <p class="m-0 max-w-[320px] text-[15px] leading-[1.55] text-ciruela-medio">
            Escriban el primero: una fecha, un lugar y lo que no quieren olvidar. Las fotografías se
            añaden después.
          </p>
          <a routerLink="new" class="nh-btn nh-btn-primario px-[22px]">Añadir un recuerdo</a>
        </div>
      }
      @default {
        @for (group of groups(); track group.key) {
          <section class="flex flex-col gap-5" [attr.aria-labelledby]="'grupo-' + group.key">
            <div class="flex items-center gap-3">
              <h2 [id]="'grupo-' + group.key" class="m-0 font-titulo text-xl font-medium">
                {{ group.label }}
              </h2>
              <div aria-hidden="true" class="h-px flex-1 bg-[#E6D9CC]"></div>
              <span class="text-[13px] font-medium text-ciruela-suave">{{ group.count }}</span>
            </div>
            @for (item of group.items; track item.memory.memoryId) {
              <a
                [routerLink]="item.memory.memoryId"
                [attr.aria-label]="'Abrir recuerdo: ' + item.memory.title + ', ' + item.date"
                class="nh-papel grid w-full items-center gap-[18px] p-3.5 text-left text-ciruela no-underline transition-shadow hover:shadow-[0_1px_2px_rgba(56,43,54,.06),0_12px_28px_rgba(56,43,54,.10)]"
                [class]="
                  item.cover === undefined
                    ? 'grid-cols-1'
                    : item.index % 2
                      ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'
                      : 'grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'
                "
              >
                @if (item.cover; as cover) {
                  <div
                    class="relative m-1.5 rounded bg-white px-2.5 pb-[30px] pt-2.5 shadow-[0_2px_8px_rgba(56,43,54,.12)]"
                    [class]="item.index % 2 ? 'rotate-[1.2deg] lg:order-2' : 'rotate-[-1.4deg]'"
                  >
                    <span
                      aria-hidden="true"
                      class="absolute left-1/2 top-[-9px] -ml-9 h-5 w-[72px] rotate-[-3deg] rounded-sm bg-[rgba(244,215,181,.85)]"
                    ></span>
                    <div class="relative aspect-[4/3] overflow-hidden rounded-sm bg-[#F1E8DE]">
                      <img
                        [src]="cover"
                        alt=""
                        loading="lazy"
                        class="absolute inset-0 size-full object-cover"
                      />
                    </div>
                    @if (item.morePhotos > 0) {
                      <span
                        class="absolute bottom-1.5 right-3 text-xs font-semibold text-ciruela-suave"
                        >+{{ item.morePhotos }} fotos</span
                      >
                    }
                  </div>
                }
                <div class="flex min-w-0 flex-col gap-[9px] px-1 pb-1.5 pt-1">
                  @if (item.cover === undefined) {
                    <span
                      aria-hidden="true"
                      class="flex items-center gap-1.5 self-start rounded-full bg-[#F7EFE6] px-2.5 py-1 text-xs font-semibold text-accion"
                      ><nh-icon name="pencil" [size]="16" />Nota escrita</span
                    >
                  }
                  <p
                    class="m-0 flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-semibold text-ciruela-suave"
                  >
                    <span>{{ item.date }}</span>
                    @if (item.memory.location) {
                      <span class="inline-flex items-center gap-1 font-medium"
                        ><nh-icon name="pin" [size]="16" />{{ item.memory.location }}</span
                      >
                    }
                  </p>
                  <h3 class="m-0 text-pretty font-titulo text-[23px] font-medium leading-[1.2]">
                    {{ item.memory.title }}
                  </h3>
                  <p class="m-0 text-pretty text-[15.5px] leading-[1.6] text-[#4B3C48]">
                    {{ item.excerpt }}
                  </p>
                  @if (item.memory.tags.length) {
                    <div class="flex flex-wrap items-center gap-1.5">
                      @for (tag of item.memory.tags.slice(0, 4); track tag) {
                        <span class="nh-chip">#{{ tag }}</span>
                      }
                    </div>
                  }
                  <nh-estado [ai]="item.memory.ingestionStatus" />
                </div>
              </a>
            }
          </section>
        }
        <div class="flex justify-center pb-2 pt-1">
          @if (nextCursor()) {
            <button
              type="button"
              class="nh-btn nh-btn-secundario"
              [disabled]="loadingOlder()"
              (click)="loadOlder()"
            >
              @if (loadingOlder()) {
                <span class="nh-giro" aria-hidden="true"></span>Cargando…
              } @else {
                Cargar recuerdos anteriores
              }
            </button>
          } @else {
            <p class="m-0 font-titulo text-[15px] italic text-ciruela-suave">
              Aquí empieza su historia. Ya están todos sus recuerdos.
            </p>
          }
        </div>
      }
    }
  </div>`,
})
export class TimelineComponent {
  private readonly api = inject(MemoriesApiService);
  private readonly live = inject(LiveAnnouncer);
  private readonly items = signal<readonly MemoryDto[]>([]);
  protected readonly nextCursor = signal<string | undefined>(undefined);
  protected readonly state = signal<'loading' | 'error' | 'empty' | 'ready'>('loading');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly loadingOlder = signal(false);

  protected readonly groups = computed<readonly TimelineGroup[]>(() => {
    const groups: { key: string; label: string; items: TimelineItem[] }[] = [];
    this.items().forEach((memory, index) => {
      const key = memory.occurredOn.slice(0, 7);
      let group = groups.at(-1);
      if (group?.key !== key) {
        group = { key, label: monthGroupLabel(memory.occurredOn), items: [] };
        groups.push(group);
      }
      const ready = memory.photos.filter((photo) => photo.status === 'READY');
      const cover = ready.find((photo) => (photo.thumbnailUrl ?? photo.displayUrl) !== undefined);
      group.items.push({
        memory,
        index,
        date: formatLongDate(memory.occurredOn),
        excerpt: excerpt(memory.body, 160),
        cover: cover?.thumbnailUrl ?? cover?.displayUrl,
        morePhotos: cover === undefined ? 0 : memory.photos.length - 1,
      });
    });
    return groups.map((group) => ({
      ...group,
      count: countLabel(group.items.length, 'recuerdo', 'recuerdos'),
    }));
  });

  public constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.state.set('loading');
    try {
      const page = await this.api.timeline();
      this.items.set(page.items);
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
      const page = await this.api.timeline(cursor);
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
      this.live.announce('Se cargaron recuerdos anteriores');
    } catch {
      this.live.announce('No pudimos cargar más recuerdos. Inténtalo de nuevo.');
    } finally {
      this.loadingOlder.set(false);
    }
  }
}
