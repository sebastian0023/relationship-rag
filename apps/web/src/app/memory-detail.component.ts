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
import type { MemoryDto } from '@relationship-rag/contracts';
import { failureMessage, isNotFound, supportReference } from './api/api-error.js';
import { MemoriesApiService } from './memories-api.service.js';
import { MAX_PHOTOS, photoProblem } from './memories/photo-rules.js';
import { LiveAnnouncer, ToastService } from './ui/avisos.service.js';
import { EstadoComponent } from './ui/estado.component.js';
import { formatLongDate } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';
import { PanelComponent } from './ui/panel.component.js';
import { returnLabel, safeReturnPath } from './ui/return-path.js';
import { AI_AVAILABILITY } from './ui/status.js';

type Photo = MemoryDto['photos'][number];

interface LocalUpload {
  readonly id: number;
  readonly file: File;
  readonly progress: number;
  readonly failed: boolean;
}

type Tile =
  | { readonly kind: 'ready'; readonly photo: Photo; readonly url: string; readonly index: number }
  | { readonly kind: 'processing'; readonly photo: Photo }
  | { readonly kind: 'failed'; readonly photo: Photo }
  | { readonly kind: 'upload'; readonly upload: LocalUpload };

const POLL_MS = 5000;
const MAX_POLLS = 60;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EstadoComponent,
    GatitosComponent,
    IconComponent,
    ListaEstadoComponent,
    PanelComponent,
    RouterLink,
  ],
  template: `
    @switch (state()) {
      @case ('loading') {
        <div role="status" aria-busy="true" class="flex flex-col gap-4 px-4 py-8 lg:px-12">
          <span class="text-[15px] font-medium text-ciruela-suave">Cargando el recuerdo…</span>
          <div class="h-8 w-3/4 rounded-md bg-[#EDE2D6]"></div>
          <div class="aspect-[4/3] max-w-[520px] rounded-xl bg-[#F1E8DE]"></div>
        </div>
      }
      @case ('missing') {
        <div class="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <nh-gatitos name="empty" />
          <h1 class="m-0 font-titulo text-[26px] font-medium leading-[1.2]">
            Este recuerdo ya no está disponible
          </h1>
          <p class="m-0 max-w-[320px] text-[15px] leading-[1.55] text-ciruela-medio">
            Es posible que se haya eliminado o que el enlace ya no funcione.
          </p>
          <a routerLink="/app/timeline" class="nh-btn nh-btn-primario px-[22px]">Ir a Recuerdos</a>
        </div>
      }
      @case ('error') {
        <div class="px-4 py-8 lg:px-12">
          <nh-lista-estado
            state="error"
            errorTitle="No pudimos abrir este recuerdo"
            [reference]="reference()"
            (retry)="load()"
          />
        </div>
      }
      @default {
        @if (memory(); as item) {
          <article class="flex flex-col">
            <div class="nh-barra-superior">
              <button type="button" class="nh-btn nh-btn-texto gap-1" (click)="goBack()">
                <nh-icon name="back" />{{ backLabel() }}
              </button>
              <a
                [routerLink]="['/app/timeline', item.memoryId, 'edit']"
                class="nh-btn nh-btn-secundario min-h-11 gap-1.5 px-3.5 text-sm"
                ><nh-icon name="pencil" />Editar recuerdo</a
              >
            </div>
            <div
              class="mx-auto box-border flex w-full max-w-[760px] flex-col gap-[22px] px-4 pb-8 pt-5 lg:px-12 lg:pb-16 lg:pt-9"
            >
              <header class="flex flex-col gap-2">
                <p
                  class="m-0 flex flex-wrap gap-x-3.5 gap-y-1 text-sm font-semibold text-ciruela-suave"
                >
                  <span class="inline-flex items-center gap-[5px]"
                    ><nh-icon name="cal" [size]="18" />{{ date() }}</span
                  >
                  @if (item.location) {
                    <span class="inline-flex items-center gap-[5px] font-medium"
                      ><nh-icon name="pin" [size]="18" />{{ item.location }}</span
                    >
                  }
                </p>
                <h1 class="m-0 text-balance font-titulo text-[34px] font-medium leading-[1.15]">
                  {{ item.title }}
                </h1>
                @if (item.category || item.tags.length) {
                  <div class="flex flex-wrap items-center gap-1.5">
                    @if (item.category) {
                      <span
                        class="rounded-full bg-lavanda px-3 py-1 text-[13px] font-semibold text-[#4E3F66]"
                        >{{ item.category }}</span
                      >
                    }
                    @for (tag of item.tags; track tag) {
                      <span class="nh-chip">#{{ tag }}</span>
                    }
                  </div>
                }
              </header>

              <section aria-labelledby="fotos-titulo" class="flex flex-col gap-2.5">
                <div class="flex items-center justify-between gap-2">
                  <h2 id="fotos-titulo" class="m-0 text-[15px] font-semibold">
                    Fotografías
                    <span class="font-medium text-ciruela-suave">· {{ photoCount() }} de 10</span>
                  </h2>
                  @if (photoCount() < maxPhotos) {
                    <button
                      type="button"
                      class="nh-btn min-h-11 gap-1.5 bg-rosa px-3.5 text-sm text-ciruela"
                      (click)="openPhotos()"
                    >
                      <nh-icon name="image" />Añadir fotografías
                    </button>
                  }
                </div>
                @if (tiles().length) {
                  <div class="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
                    @for (tile of tiles(); track $index) {
                      <div
                        class="relative aspect-square overflow-hidden rounded-xl border border-borde bg-[#F1E8DE]"
                        [class]="$first ? 'lg:col-span-2 lg:row-span-2' : ''"
                      >
                        @switch (tile.kind) {
                          @case ('ready') {
                            @if (tile.kind === 'ready') {
                              <button
                                type="button"
                                class="absolute inset-0 cursor-zoom-in p-0"
                                [attr.aria-label]="
                                  'Ver fotografía ' +
                                  (tile.index + 1) +
                                  ' de ' +
                                  readyPhotos().length
                                "
                                (click)="openViewer(tile.index)"
                              >
                                <img
                                  [src]="tile.url"
                                  alt=""
                                  loading="lazy"
                                  class="absolute inset-0 size-full object-cover"
                                  (error)="refreshExpiredUrls()"
                                />
                              </button>
                            }
                          }
                          @case ('processing') {
                            <div
                              role="status"
                              class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[rgba(255,254,251,.82)] p-3 text-center text-[#6A4A1E]"
                            >
                              <span class="nh-giro" aria-hidden="true"></span
                              ><span class="text-[13px] font-semibold">Procesando…</span>
                            </div>
                          }
                          @case ('failed') {
                            @if (tile.kind === 'failed') {
                              <div
                                role="alert"
                                class="absolute inset-0 flex flex-col justify-center gap-1.5 bg-[#FFF1EF] p-2.5 text-[#8A2B25]"
                              >
                                <span class="flex items-center gap-1.5 text-[13px] font-semibold"
                                  ><nh-icon name="alert" [size]="18" />No se pudo procesar</span
                                >
                                <button
                                  type="button"
                                  class="min-h-9 self-start rounded-full px-2.5 text-[13px] font-semibold"
                                  aria-label="Quitar la fotografía que no se pudo procesar"
                                  (click)="removeServerPhoto(tile.photo.photoId)"
                                >
                                  Quitar
                                </button>
                              </div>
                            }
                          }
                          @case ('upload') {
                            @if (tile.kind === 'upload') {
                              @if (tile.upload.failed) {
                                <div
                                  role="alert"
                                  class="absolute inset-0 flex flex-col justify-center gap-1.5 bg-[#FFF1EF] p-2.5 text-[#8A2B25]"
                                >
                                  <span class="flex items-center gap-1.5 text-[13px] font-semibold"
                                    ><nh-icon name="alert" [size]="18" />No se pudo subir</span
                                  >
                                  <div class="flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      class="min-h-9 rounded-full border-[1.5px] border-[#D9A7A0] bg-papel px-2.5 text-[13px] font-semibold text-ciruela"
                                      (click)="retryUpload(tile.upload.id)"
                                    >
                                      Reintentar
                                    </button>
                                    <button
                                      type="button"
                                      class="min-h-9 rounded-full px-2.5 text-[13px] font-semibold"
                                      [attr.aria-label]="'Quitar ' + tile.upload.file.name"
                                      (click)="dropUpload(tile.upload.id)"
                                    >
                                      Quitar
                                    </button>
                                  </div>
                                </div>
                              } @else {
                                <div
                                  role="status"
                                  class="absolute inset-0 flex flex-col justify-center gap-2 bg-[rgba(255,254,251,.82)] p-3"
                                >
                                  <span class="text-[13px] font-semibold"
                                    >Subiendo… {{ tile.upload.progress }} %</span
                                  >
                                  <span class="h-1.5 overflow-hidden rounded-full bg-borde"
                                    ><span
                                      class="block h-full bg-accion transition-[width] duration-200"
                                      [style.width.%]="tile.upload.progress"
                                    ></span
                                  ></span>
                                  <span class="truncate text-xs text-ciruela-suave">{{
                                    tile.upload.file.name
                                  }}</span>
                                </div>
                              }
                            }
                          }
                        }
                      </div>
                    }
                  </div>
                } @else {
                  <div
                    class="rounded-[14px] border-[1.5px] border-dashed border-campo px-4 py-[22px] text-center text-[15px] leading-normal text-ciruela-suave"
                  >
                    Este recuerdo aún no tiene fotografías. Puedes añadir hasta 10.
                  </div>
                }
                @if (photoCount() >= maxPhotos) {
                  <p class="m-0 text-[13px] font-medium text-ciruela-suave">
                    Llegaste al máximo de 10 fotografías.
                  </p>
                }
              </section>

              <div
                class="max-w-[62ch] whitespace-pre-wrap text-pretty text-[17.5px] leading-[1.75] text-ciruela"
                [textContent]="item.body"
              ></div>
              <p class="m-0 text-[13px] text-ciruela-suave">
                Idioma del contenido: {{ item.locale === 'en' ? 'Inglés' : 'Español' }}
              </p>

              <section
                aria-label="Disponibilidad para conversar"
                class="flex flex-col gap-2.5 rounded-2xl border border-borde bg-papel p-4"
              >
                <div aria-live="polite" class="flex flex-wrap items-center gap-2">
                  <nh-estado [ai]="item.ingestionStatus" [large]="true" />
                </div>
                <p class="m-0 text-[14.5px] leading-normal text-ciruela-medio">
                  {{ availability().help }}
                </p>
                @if (availability().canPrepare) {
                  <button
                    type="button"
                    class="nh-btn nh-btn-oscuro min-h-[46px] self-start px-[18px]"
                    [disabled]="preparing()"
                    (click)="prepare()"
                  >
                    <nh-icon name="sparkle" />Preparar para conversar
                  </button>
                }
                @if (availability().canRetry) {
                  <button
                    type="button"
                    class="nh-btn nh-btn-secundario min-h-[46px] self-start px-[18px]"
                    [disabled]="preparing()"
                    (click)="prepare()"
                  >
                    <nh-icon name="refresh" />Intentar de nuevo
                  </button>
                }
                <p class="m-0 text-[13px] leading-normal text-ciruela-suave">
                  La IA consulta el texto guardado del recuerdo. No interpreta sus fotografías.
                </p>
              </section>

              <div class="flex flex-col gap-1.5 border-t border-borde pt-3.5">
                <button
                  type="button"
                  class="nh-btn nh-btn-peligro self-start"
                  (click)="panel.set('delete')"
                >
                  <nh-icon name="trash" />Eliminar recuerdo
                </button>
              </div>
            </div>
          </article>

          <nh-panel
            [open]="panel() === 'photos'"
            labelledBy="panel-fotos-titulo"
            (closed)="closePanel('photos')"
          >
            <div class="flex flex-col gap-3.5">
              <h2 id="panel-fotos-titulo" class="nh-panel-titulo">Añadir fotografías</h2>
              <p class="m-0 text-[14.5px] leading-normal text-ciruela-medio">
                JPEG, PNG o WebP · hasta 10 MiB cada una · {{ photoCount() }} de 10 usadas.
              </p>
              <input
                #fileInput
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                class="hidden"
                aria-hidden="true"
                tabindex="-1"
                (change)="filesChosen($event)"
              />
              <button
                type="button"
                class="nh-btn nh-btn-primario min-h-[54px] gap-2.5 rounded-[14px] text-base"
                (click)="fileInput.click()"
              >
                <nh-icon name="upload" />Elegir de la galería o la cámara
              </button>
              <p class="nh-ayuda m-0">
                Tu navegador mostrará las opciones disponibles en tu dispositivo.
              </p>
              @if (photoMessage(); as message) {
                <div role="alert" class="nh-alerta">
                  <nh-icon name="alert" /><span>{{ message }}</span>
                </div>
              }
              <button type="button" class="nh-btn nh-btn-texto min-h-12" (click)="panel.set(null)">
                Cancelar
              </button>
            </div>
          </nh-panel>

          <nh-panel
            [open]="panel() === 'delete'"
            labelledBy="panel-eliminar-titulo"
            (closed)="closePanel('delete')"
          >
            <div class="flex flex-col gap-3.5">
              <h2 id="panel-eliminar-titulo" class="nh-panel-titulo">
                ¿Eliminar «{{ item.title }}»?
              </h2>
              <p class="nh-panel-texto">
                Se eliminará el recuerdo del {{ date() }} para los dos.
                @if (item.photos.length === 1) {
                  También se eliminará su fotografía.
                } @else if (item.photos.length > 1) {
                  También se eliminarán sus {{ item.photos.length }} fotografías.
                }
                Esta acción no se puede deshacer.
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
                (click)="deleteMemory()"
              >
                @if (deleting()) {
                  <span class="nh-giro" aria-hidden="true"></span>
                } @else {
                  <nh-icon name="trash" />
                }
                Eliminar recuerdo
              </button>
            </div>
          </nh-panel>

          <nh-panel
            [open]="panel() === 'viewer'"
            variant="full"
            label="Fotografía ampliada"
            (closed)="closePanel('viewer')"
          >
            @if (viewerPhoto(); as current) {
              <div class="flex h-full flex-col" (keydown)="viewerKey($event)">
                <div class="flex items-center justify-between px-3 py-2.5">
                  <span aria-live="polite" class="pl-1.5 text-sm font-semibold"
                    >{{ viewerIndex() + 1 }} de {{ readyPhotos().length }}</span
                  >
                  <button
                    type="button"
                    class="nh-btn min-h-11 gap-1.5 border-[1.5px] border-[rgba(255,254,251,.4)] bg-transparent px-3.5 text-sm text-papel"
                    (click)="panel.set(null)"
                  >
                    <nh-icon name="close" />Cerrar
                  </button>
                </div>
                <div class="flex min-h-0 flex-1 items-center justify-center px-3 py-2">
                  <img
                    [src]="current.url"
                    [alt]="'Fotografía ' + (viewerIndex() + 1) + ' de «' + item.title + '»'"
                    class="max-h-full max-w-full object-contain"
                  />
                </div>
                <div
                  class="flex flex-col gap-2.5 px-3 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3"
                >
                  <div class="flex justify-between gap-2.5">
                    <button
                      type="button"
                      class="nh-btn flex-1 gap-1.5 border-[1.5px] border-[rgba(255,254,251,.4)] bg-transparent text-papel"
                      [disabled]="viewerIndex() === 0"
                      (click)="step(-1)"
                    >
                      <nh-icon name="back" />Anterior
                    </button>
                    <button
                      type="button"
                      class="nh-btn flex-1 gap-1.5 border-[1.5px] border-[rgba(255,254,251,.4)] bg-transparent text-papel"
                      [disabled]="viewerIndex() >= readyPhotos().length - 1"
                      (click)="step(1)"
                    >
                      Siguiente<nh-icon name="fwd" />
                    </button>
                  </div>
                  @if (confirmPhotoDelete()) {
                    <div role="alert" class="flex flex-col gap-2 rounded-[14px] bg-[#2E2330] p-3">
                      <span class="text-[14.5px] font-medium leading-[1.45]"
                        >¿Eliminar esta fotografía del recuerdo? No se puede deshacer.</span
                      >
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="nh-btn min-h-[46px] flex-1 bg-papel text-sm text-ciruela"
                          (click)="confirmPhotoDelete.set(false)"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          class="nh-btn min-h-[46px] flex-1 border-[1.5px] border-[#F4B3AC] bg-transparent text-sm text-[#F4B3AC]"
                          [disabled]="deletingPhoto()"
                          (click)="deleteViewerPhoto()"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  } @else {
                    <button
                      type="button"
                      class="nh-btn min-h-11 gap-1.5 self-center bg-transparent px-3.5 text-sm text-[#F4B3AC]"
                      (click)="confirmPhotoDelete.set(true)"
                    >
                      <nh-icon name="trash" />Eliminar fotografía
                    </button>
                  }
                  <p class="m-0 text-center text-[12.5px] text-[rgba(255,254,251,.75)]">
                    También puedes usar las flechas del teclado.
                  </p>
                </div>
              </div>
            }
          </nh-panel>
        }
      }
    }
  `,
})
export class MemoryDetailComponent {
  private readonly api = inject(MemoriesApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly live = inject(LiveAnnouncer);

  protected readonly maxPhotos = MAX_PHOTOS;
  protected readonly memory = signal<MemoryDto | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly panel = signal<'photos' | 'delete' | 'viewer' | null>(null);
  protected readonly photoMessage = signal<string | null>(null);
  protected readonly uploads = signal<readonly LocalUpload[]>([]);
  protected readonly viewerIndex = signal(0);
  protected readonly confirmPhotoDelete = signal(false);
  protected readonly preparing = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deletingPhoto = signal(false);

  private memoryId = '';
  private readonly returnPath = signal<string | null>(null);
  private nextUploadId = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private polls = 0;
  private lastUrlRefresh = 0;

  protected readonly backLabel = computed(() => returnLabel(this.returnPath()));
  protected readonly date = computed(() => {
    const memory = this.memory();
    return memory === null ? '' : formatLongDate(memory.occurredOn);
  });
  protected readonly availability = computed(
    () => AI_AVAILABILITY[this.memory()?.ingestionStatus ?? 'NOT_REQUESTED'],
  );
  protected readonly readyPhotos = computed(() =>
    (this.memory()?.photos ?? []).flatMap((photo) =>
      photo.status === 'READY' && photo.displayUrl !== undefined
        ? [{ photo, url: photo.displayUrl }]
        : [],
    ),
  );
  protected readonly photoCount = computed(
    () =>
      (this.memory()?.photos.length ?? 0) +
      this.uploads().filter((upload) => !upload.failed).length,
  );
  protected readonly tiles = computed<readonly Tile[]>(() => {
    let readyIndex = 0;
    const server = (this.memory()?.photos ?? []).map((photo): Tile => {
      if (photo.status === 'FAILED') return { kind: 'failed', photo };
      const url = photo.thumbnailUrl ?? photo.displayUrl;
      if (photo.status === 'READY' && url !== undefined && photo.displayUrl !== undefined)
        return { kind: 'ready', photo, url, index: readyIndex++ };
      return { kind: 'processing', photo };
    });
    return [...server, ...this.uploads().map((upload): Tile => ({ kind: 'upload', upload }))];
  });
  protected readonly viewerPhoto = computed(() => this.readyPhotos()[this.viewerIndex()]);

  public constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.memoryId = params.get('memoryId') ?? '';
      this.returnPath.set(safeReturnPath(this.route.snapshot.queryParamMap.get('from')));
      this.memory.set(null);
      this.uploads.set([]);
      void this.load();
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      this.memory.set(await this.api.get(this.memoryId));
      this.state.set('ready');
      this.schedulePoll(true);
    } catch (error) {
      this.reference.set(supportReference(error));
      this.state.set(isNotFound(error) ? 'missing' : 'error');
    }
  }

  protected goBack(): void {
    void this.router.navigateByUrl(this.returnPath() ?? '/app/timeline');
  }

  protected closePanel(panel: 'photos' | 'delete' | 'viewer'): void {
    if (this.panel() === panel) this.panel.set(null);
    this.confirmPhotoDelete.set(false);
  }

  protected openPhotos(): void {
    this.photoMessage.set(null);
    this.panel.set('photos');
  }

  protected filesChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const accepted: File[] = [];
    for (const file of files) {
      const problem = photoProblem(file, this.photoCount() + accepted.length);
      if (problem !== null) {
        this.photoMessage.set(problem);
        this.live.announce('Archivo no compatible');
        break;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;
    if (accepted.length === files.length) this.panel.set(null);
    for (const file of accepted) {
      const upload: LocalUpload = { id: ++this.nextUploadId, file, progress: 0, failed: false };
      this.uploads.update((uploads) => [...uploads, upload]);
      this.live.announce(`Subiendo ${file.name}`);
      void this.upload(upload.id);
    }
  }

  protected retryUpload(id: number): void {
    this.patchUpload(id, { failed: false, progress: 0 });
    void this.upload(id);
  }

  protected dropUpload(id: number): void {
    this.uploads.update((uploads) => uploads.filter((upload) => upload.id !== id));
  }

  protected async removeServerPhoto(photoId: string): Promise<void> {
    try {
      await this.api.deletePhoto(this.memoryId, photoId);
      await this.reload();
    } catch (error) {
      this.toasts.show(failureMessage(error, 'No pudimos quitar la fotografía.'), 'err');
    }
  }

  protected openViewer(index: number): void {
    this.viewerIndex.set(index);
    this.confirmPhotoDelete.set(false);
    this.panel.set('viewer');
  }

  protected step(delta: number): void {
    const last = this.readyPhotos().length - 1;
    this.viewerIndex.update((index) => Math.max(0, Math.min(last, index + delta)));
    this.confirmPhotoDelete.set(false);
  }

  protected viewerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') this.step(-1);
    if (event.key === 'ArrowRight') this.step(1);
  }

  protected async deleteViewerPhoto(): Promise<void> {
    const current = this.viewerPhoto();
    if (current === undefined || this.deletingPhoto()) return;
    this.deletingPhoto.set(true);
    try {
      await this.api.deletePhoto(this.memoryId, current.photo.photoId);
      await this.reload();
      const remaining = this.readyPhotos().length;
      this.confirmPhotoDelete.set(false);
      if (remaining === 0) this.panel.set(null);
      else this.viewerIndex.update((index) => Math.min(index, remaining - 1));
      this.toasts.show('Eliminamos la fotografía.');
    } catch (error) {
      this.toasts.show(failureMessage(error, 'No pudimos eliminar la fotografía.'), 'err');
    } finally {
      this.deletingPhoto.set(false);
    }
  }

  protected async prepare(): Promise<void> {
    if (this.preparing()) return;
    this.preparing.set(true);
    try {
      const ingestion = await this.api.reindex(this.memoryId);
      this.memory.update((memory) =>
        memory === null ? memory : { ...memory, ingestionStatus: ingestion.status },
      );
      this.live.announce('Preparando este recuerdo…');
      this.schedulePoll(true);
    } catch (error) {
      this.toasts.show(failureMessage(error, 'No pudimos prepararlo. Inténtalo de nuevo.'), 'err');
    } finally {
      this.preparing.set(false);
    }
  }

  protected async deleteMemory(): Promise<void> {
    const memory = this.memory();
    if (memory === null || this.deleting()) return;
    this.deleting.set(true);
    try {
      await this.api.delete(memory.memoryId);
      this.panel.set(null);
      this.toasts.show(
        memory.photos.length
          ? `Eliminamos «${memory.title}» y sus fotografías.`
          : `Eliminamos «${memory.title}».`,
      );
      await this.router.navigateByUrl('/app/timeline', { replaceUrl: true });
    } catch (error) {
      this.toasts.show(failureMessage(error, 'No pudimos eliminar el recuerdo.'), 'err');
    } finally {
      this.deleting.set(false);
    }
  }

  /** Display URLs expire after five minutes; reload the memory for fresh ones, at most twice a minute. */
  protected refreshExpiredUrls(): void {
    if (Date.now() - this.lastUrlRefresh < 30_000) return;
    this.lastUrlRefresh = Date.now();
    void this.reload();
  }

  private async upload(id: number): Promise<void> {
    const upload = this.uploads().find((item) => item.id === id);
    if (upload === undefined) return;
    let reservedPhotoId: string | undefined;
    try {
      const instructions = await this.api.createUpload(this.memoryId, upload.file);
      reservedPhotoId = instructions.photoId;
      await this.api.uploadFile(instructions, upload.file, (fraction) =>
        this.patchUpload(id, { progress: Math.round(fraction * 100) }),
      );
      this.dropUpload(id);
      await this.reload();
      this.schedulePoll(true);
    } catch {
      this.patchUpload(id, { failed: true });
      this.live.announce(`No se pudo subir ${upload.file.name}`);
      // Release the reserved slot so a failed transfer does not count toward the limit.
      if (reservedPhotoId !== undefined)
        await this.api.deletePhoto(this.memoryId, reservedPhotoId).catch(() => undefined);
    }
  }

  private patchUpload(id: number, patch: Partial<LocalUpload>): void {
    this.uploads.update((uploads) =>
      uploads.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)),
    );
  }

  private async reload(): Promise<void> {
    const previous = this.memory();
    const next = await this.api.get(this.memoryId);
    this.memory.set(next);
    if (previous === null) return;
    if (previous.ingestionStatus === 'PENDING' && next.ingestionStatus === 'INDEXED')
      this.toasts.show('Este recuerdo ya está disponible para conversar.');
    if (previous.ingestionStatus === 'PENDING' && next.ingestionStatus === 'FAILED')
      this.live.announce('No pudimos preparar este recuerdo.');
    const before = new Map(previous.photos.map((photo) => [photo.photoId, photo.status]));
    for (const photo of next.photos) {
      if (before.get(photo.photoId) !== 'PENDING') continue;
      if (photo.status === 'READY') this.live.announce('Fotografía lista');
      if (photo.status === 'FAILED') this.live.announce('No se pudo procesar una fotografía');
    }
  }

  /** Polls while indexing or photo processing is in progress, for about five minutes. */
  private schedulePoll(restart = false): void {
    if (restart) this.polls = 0;
    clearTimeout(this.pollTimer);
    const memory = this.memory();
    const pending =
      memory !== null &&
      (memory.ingestionStatus === 'PENDING' ||
        memory.photos.some((photo) => photo.status === 'PENDING'));
    if (!pending || this.polls >= MAX_POLLS) return;
    this.pollTimer = setTimeout(async () => {
      this.polls += 1;
      try {
        await this.reload();
      } catch {
        /* The next poll or a manual reload recovers. */
      }
      this.schedulePoll();
    }, POLL_MS);
  }
}
