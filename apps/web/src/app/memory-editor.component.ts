import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Locale, MemoryDto } from '@relationship-rag/contracts';
import { failureMessage, isConflict, isNotFound, supportReference } from './api/api-error.js';
import { MemoriesApiService } from './memories-api.service.js';
import {
  MEMORY_LIMITS,
  addTag,
  emptyMemoryForm,
  errorCount,
  errorSummary,
  isMemoryFormDirty,
  memoryFormFrom,
  memoryFormKey,
  memoryRequestFrom,
  validateMemoryForm,
  type MemoryField,
  type MemoryFormErrors,
  type MemoryFormValue,
} from './memories/memory-form.js';
import { LiveAnnouncer, ToastService } from './ui/avisos.service.js';
import { counterLabel, relativeTime } from './ui/format.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';
import { ListaEstadoComponent } from './ui/lista-estado.component.js';
import { PanelComponent } from './ui/panel.component.js';
import { LeaveDecision, type GuardsUnsavedChanges } from './ui/unsaved-changes.guard.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent, IconComponent, ListaEstadoComponent, PanelComponent, RouterLink],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)', class: 'flex flex-1 flex-col' },
  template: `
    @switch (state()) {
      @case ('loading') {
        <div role="status" aria-busy="true" class="px-4 py-8 text-[15px] text-ciruela-suave">
          Cargando el recuerdo…
        </div>
      }
      @case ('missing') {
        <div class="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <nh-gatitos name="empty" />
          <h1 class="m-0 font-titulo text-[26px] font-medium leading-[1.2]">
            Este recuerdo ya no está disponible
          </h1>
          <a routerLink="/app/timeline" class="nh-btn nh-btn-primario px-[22px]">Ir a Recuerdos</a>
        </div>
      }
      @case ('error') {
        <div class="px-4 py-8">
          <nh-lista-estado
            state="error"
            errorTitle="No pudimos abrir este recuerdo"
            [reference]="reference()"
            (retry)="load()"
          />
        </div>
      }
      @default {
        <form novalidate class="flex flex-1 flex-col" (submit)="submit($event)">
          <div class="nh-barra-superior">
            <button type="button" class="nh-btn nh-btn-texto gap-1" (click)="cancel()">
              <nh-icon name="close" />Cancelar
            </button>
            <h1 class="m-0 font-titulo text-[19px] font-medium">
              {{ memoryId === null ? 'Nuevo recuerdo' : 'Editar recuerdo' }}
            </h1>
            <span
              aria-live="polite"
              class="min-w-[88px] pr-2 text-right text-[12.5px] font-semibold text-[#8A5A1F]"
              >{{ dirty() ? '● Sin guardar' : '' }}</span
            >
          </div>
          <div
            class="mx-auto box-border flex w-full flex-1 flex-col gap-[22px] px-4 pb-8 pt-5 lg:max-w-[680px] lg:px-12 lg:pb-16 lg:pt-9"
          >
            @if (errorTotal()) {
              <div #errorSummaryBox tabindex="-1" role="alert" class="nh-alerta outline-none">
                <nh-icon name="alert" />{{ summary() }}
              </div>
            }
            <div class="flex flex-col gap-1.5">
              <div class="flex justify-between gap-2">
                <label for="mf-title" class="nh-etiqueta-campo"
                  >Título <span class="text-accion" aria-hidden="true">*</span></label
                ><span class="text-[13px] font-medium text-ciruela-suave">{{
                  counter(form().title, limits.title)
                }}</span>
              </div>
              <input
                id="mf-title"
                class="nh-campo"
                maxlength="140"
                required
                placeholder="Por ejemplo: La tarde del museo"
                [value]="form().title"
                [attr.aria-invalid]="!!errors().title"
                [attr.aria-describedby]="errors().title ? 'mf-title-e' : null"
                (input)="set('title', $event)"
              />
              @if (errors().title) {
                <p id="mf-title-e" class="nh-error-campo">
                  <nh-icon name="alert" />{{ errors().title }}
                </p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="mf-date" class="nh-etiqueta-campo"
                >Fecha del recuerdo <span class="text-accion" aria-hidden="true">*</span></label
              >
              <input
                id="mf-date"
                type="date"
                class="nh-campo"
                required
                [value]="form().occurredOn"
                [attr.aria-invalid]="!!errors().occurredOn"
                [attr.aria-describedby]="errors().occurredOn ? 'mf-date-e' : null"
                (input)="set('occurredOn', $event)"
              />
              @if (errors().occurredOn) {
                <p id="mf-date-e" class="nh-error-campo">
                  <nh-icon name="alert" />{{ errors().occurredOn }}
                </p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <div class="flex justify-between gap-2">
                <label for="mf-place" class="nh-etiqueta-campo"
                  >Lugar <span class="font-normal text-ciruela-suave">(opcional)</span></label
                ><span class="text-[13px] font-medium text-ciruela-suave">{{
                  counter(form().location, limits.location)
                }}</span>
              </div>
              <input
                id="mf-place"
                class="nh-campo"
                placeholder="Dónde pasó"
                [value]="form().location"
                [attr.aria-invalid]="!!errors().location"
                [attr.aria-describedby]="errors().location ? 'mf-place-e' : null"
                (input)="set('location', $event)"
              />
              @if (errors().location) {
                <p id="mf-place-e" class="nh-error-campo">
                  <nh-icon name="alert" />{{ errors().location }}
                </p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <div class="flex justify-between gap-2">
                <label for="mf-text" class="nh-etiqueta-campo"
                  >Recuerdo <span class="text-accion" aria-hidden="true">*</span></label
                ><span class="text-[13px] font-medium text-ciruela-suave">{{
                  counter(form().body, limits.body)
                }}</span>
              </div>
              <p id="mf-text-h" class="m-0 text-[13.5px] leading-[1.45] text-ciruela-suave">
                Cuéntalo como quieras recordarlo. La IA solo consultará este texto.
              </p>
              <textarea
                id="mf-text"
                rows="8"
                required
                class="nh-campo min-h-[190px] resize-y bg-[repeating-linear-gradient(transparent_0_27px,#F3E9DF_27px_28px)] bg-[position:0_13px] p-3.5 leading-7"
                placeholder="Qué pasó, quién dijo qué, qué no quieren olvidar…"
                [value]="form().body"
                [attr.aria-invalid]="!!errors().body"
                [attr.aria-describedby]="errors().body ? 'mf-text-h mf-text-e' : 'mf-text-h'"
                (input)="set('body', $event)"
              ></textarea>
              @if (errors().body) {
                <p id="mf-text-e" class="nh-error-campo">
                  <nh-icon name="alert" />{{ errors().body }}
                </p>
              }
            </div>
            <div class="flex flex-col gap-2">
              <div class="flex justify-between gap-2">
                <label for="mf-tag" class="nh-etiqueta-campo"
                  >Etiquetas <span class="font-normal text-ciruela-suave">(opcional)</span></label
                ><span class="text-[13px] font-medium text-ciruela-suave"
                  >{{ form().tags.length }} de 20</span
                >
              </div>
              @if (form().tags.length) {
                <ul
                  aria-label="Etiquetas añadidas"
                  class="m-0 flex list-none flex-wrap gap-1.5 p-0"
                >
                  @for (tag of form().tags; track tag) {
                    <li
                      class="flex min-h-9 items-center gap-0.5 rounded-full bg-arena py-0 pl-3 pr-0.5 text-sm font-medium"
                    >
                      #{{ tag }}
                      <button
                        type="button"
                        class="flex size-9 items-center justify-center rounded-full text-ciruela-medio"
                        [attr.aria-label]="'Quitar etiqueta ' + tag"
                        (click)="removeTag(tag)"
                      >
                        <nh-icon name="close" [size]="18" />
                      </button>
                    </li>
                  }
                </ul>
              }
              <div class="flex gap-2">
                <input
                  id="mf-tag"
                  class="nh-campo min-h-12 min-w-0 flex-1"
                  placeholder="Escribe y pulsa Añadir"
                  aria-describedby="mf-tag-h"
                  [value]="form().tagInput"
                  [attr.aria-invalid]="!!errors().tags"
                  (input)="set('tagInput', $event)"
                  (keydown)="tagKey($event)"
                />
                <button
                  type="button"
                  class="nh-btn nh-btn-secundario rounded-xl px-4"
                  (click)="commitTag()"
                >
                  Añadir
                </button>
              </div>
              <p id="mf-tag-h" class="nh-ayuda m-0">
                Hasta 20 etiquetas de 40 caracteres. {{ counter(form().tagInput, limits.tag) }}
              </p>
              @if (errors().tags) {
                <p class="nh-error-campo"><nh-icon name="alert" />{{ errors().tags }}</p>
              }
            </div>
            <div class="flex flex-col gap-1.5">
              <div class="flex justify-between gap-2">
                <label for="mf-cat" class="nh-etiqueta-campo"
                  >Categoría <span class="font-normal text-ciruela-suave">(opcional)</span></label
                ><span class="text-[13px] font-medium text-ciruela-suave">{{
                  counter(form().category, limits.category)
                }}</span>
              </div>
              <input
                id="mf-cat"
                class="nh-campo"
                placeholder="Por ejemplo: Viajes"
                [value]="form().category"
                [attr.aria-invalid]="!!errors().category"
                [attr.aria-describedby]="errors().category ? 'mf-cat-e' : null"
                (input)="set('category', $event)"
              />
              @if (errors().category) {
                <p id="mf-cat-e" class="nh-error-campo">
                  <nh-icon name="alert" />{{ errors().category }}
                </p>
              }
            </div>
            <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
              <legend class="nh-etiqueta-campo mb-2 p-0">Idioma del contenido</legend>
              <div class="flex gap-1.5">
                @for (option of locales; track option.value) {
                  <label class="nh-opcion"
                    ><input
                      type="radio"
                      name="mf-locale"
                      class="sr-only"
                      [value]="option.value"
                      [checked]="form().locale === option.value"
                      (change)="setLocale(option.value)"
                    />{{ option.label }}</label
                  >
                }
              </div>
            </fieldset>
            @if (memoryId === null) {
              <p class="m-0 flex gap-2 text-sm leading-normal text-ciruela-suave">
                <nh-icon name="image" />Podrás añadir fotografías después de guardarlo.
              </p>
            }
          </div>
          <div class="nh-barra-inferior">
            <button
              type="submit"
              class="nh-btn nh-btn-primario min-h-[52px] w-full max-w-[480px] gap-2.5 text-base"
              [disabled]="saving()"
              [attr.aria-disabled]="saving()"
            >
              @if (saving()) {
                <span class="nh-giro" aria-hidden="true"></span>Guardando…
              } @else {
                Guardar recuerdo
              }
            </button>
          </div>
        </form>
      }
    }

    <nh-panel [open]="panel() === 'leave'" labelledBy="panel-salir-titulo" (closed)="closeLeave()">
      <div class="flex flex-col gap-3.5">
        <h2 id="panel-salir-titulo" class="nh-panel-titulo">¿Salir sin guardar?</h2>
        <p class="nh-panel-texto">
          Tienes cambios en este recuerdo que todavía no guardaste. Si sales, se perderán.
        </p>
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

    <nh-panel
      [open]="panel() === 'conflict'"
      labelledBy="panel-conflicto-titulo"
      (closed)="closeConflict()"
    >
      @if (conflict(); as theirs) {
        <div class="flex flex-col gap-3.5">
          <h2 id="panel-conflicto-titulo" class="nh-panel-titulo">
            Este recuerdo cambió mientras escribías
          </h2>
          <p class="nh-panel-texto">
            Se guardó una versión nueva de «{{ theirs.title }}» {{ conflictAge() }}. Tu texto sigue
            aquí; nada se ha sobrescrito.
          </p>
          <div class="flex flex-col gap-1.5">
            <span class="text-xs font-bold uppercase tracking-[.05em] text-ciruela-suave"
              >Tu versión</span
            >
            <p
              class="m-0 max-h-[110px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-borde bg-papel p-3 text-[14.5px] leading-[1.55]"
              [textContent]="form().body"
            ></p>
          </div>
          <button
            type="button"
            class="nh-btn nh-btn-secundario min-h-11 gap-1.5 self-start px-3.5 text-sm"
            [attr.aria-expanded]="conflictOpen()"
            aria-controls="conflicto-actual"
            (click)="conflictOpen.set(!conflictOpen())"
          >
            <nh-icon name="eye" />{{
              conflictOpen() ? 'Ocultar versión actual' : 'Revisar versión actual'
            }}
          </button>
          @if (conflictOpen()) {
            <div id="conflicto-actual" class="flex flex-col gap-1.5">
              <span class="text-xs font-bold uppercase tracking-[.05em] text-ciruela-suave"
                >Versión actual guardada</span
              >
              <p
                class="m-0 max-h-[140px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#DCD0EA] bg-[#F4EFF9] p-3 text-[14.5px] leading-[1.55]"
                [textContent]="theirs.body"
              ></p>
            </div>
          }
          <button type="button" class="nh-btn nh-btn-oscuro nh-btn-panel" (click)="closeConflict()">
            Seguir editando mi texto
          </button>
          <button
            type="button"
            class="nh-btn nh-btn-accion-contorno nh-btn-panel text-[15px]"
            [disabled]="saving()"
            (click)="replaceTheirs()"
          >
            Guardar mi versión y reemplazar la suya
          </button>
          <button
            type="button"
            class="nh-btn nh-btn-texto min-h-11 gap-1.5 text-sm"
            (click)="copyMine()"
          >
            <nh-icon name="copy" />Copiar mi texto
          </button>
        </div>
      }
    </nh-panel>
  `,
})
export class MemoryEditorComponent implements GuardsUnsavedChanges {
  private readonly api = inject(MemoriesApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  private readonly live = inject(LiveAnnouncer);
  private readonly summaryRef = viewChild<ElementRef<HTMLElement>>('errorSummaryBox');
  private readonly leave = new LeaveDecision();

  protected readonly memoryId = this.route.snapshot.paramMap.get('memoryId');
  protected readonly limits = MEMORY_LIMITS;
  protected readonly locales: readonly { value: Locale; label: string }[] = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'Inglés' },
  ];
  protected readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>(
    this.memoryId === null ? 'ready' : 'loading',
  );
  protected readonly reference = signal<string | undefined>(undefined);
  protected readonly form = signal<MemoryFormValue>(emptyMemoryForm());
  protected readonly errors = signal<MemoryFormErrors>({});
  protected readonly saving = signal(false);
  protected readonly panel = signal<'leave' | 'conflict' | null>(null);
  protected readonly conflict = signal<MemoryDto | null>(null);
  protected readonly conflictOpen = signal(false);
  private readonly savedKey = signal(memoryFormKey(emptyMemoryForm()));
  private version = 1;

  protected readonly dirty = computed(() => isMemoryFormDirty(this.form(), this.savedKey()));
  protected readonly errorTotal = computed(() => errorCount(this.errors()));
  protected readonly summary = computed(() => errorSummary(this.errors()));
  protected readonly conflictAge = computed(() => {
    const theirs = this.conflict();
    return theirs === null ? '' : relativeTime(theirs.updatedAt, new Date());
  });

  public constructor() {
    if (this.memoryId !== null) void this.load();
  }

  public canLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.panel.set('leave');
    return this.leave.ask();
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  protected async load(): Promise<void> {
    if (this.memoryId === null) return;
    this.state.set('loading');
    try {
      this.adopt(await this.api.get(this.memoryId));
      this.state.set('ready');
    } catch (error) {
      this.reference.set(supportReference(error));
      this.state.set(isNotFound(error) ? 'missing' : 'error');
    }
  }

  protected counter(value: string, max: number): string {
    return counterLabel(value, max);
  }

  protected set(field: keyof MemoryFormValue & string, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.form.update((form) => ({ ...form, [field]: value }));
    const errorField: MemoryField | undefined =
      field === 'tagInput' ? 'tags' : field === 'locale' || field === 'tags' ? undefined : field;
    if (errorField !== undefined) this.clearError(errorField);
  }

  protected setLocale(locale: Locale): void {
    this.form.update((form) => ({ ...form, locale }));
  }

  protected tagKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitTag();
    }
  }

  protected commitTag(): void {
    const result = addTag(this.form());
    if (result.ok) {
      this.form.set(result.form);
      this.clearError('tags');
      this.live.announce(`Etiqueta ${result.tag} añadida`);
    } else if (result.error !== null) {
      const tags = result.error;
      this.errors.update((errors) => ({ ...errors, tags }));
    }
  }

  protected removeTag(tag: string): void {
    this.form.update((form) => ({ ...form, tags: form.tags.filter((item) => item !== tag) }));
    this.live.announce(`Etiqueta ${tag} quitada`);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    void this.save(this.version);
  }

  protected cancel(): void {
    void this.router.navigate(
      this.memoryId === null ? ['/app/timeline'] : ['/app/timeline', this.memoryId],
    );
  }

  protected closeLeave(): void {
    this.panel.set(null);
    this.leave.answer(false);
  }

  protected leaveWithoutSaving(): void {
    this.panel.set(null);
    this.leave.answer(true);
  }

  protected closeConflict(): void {
    if (this.panel() === 'conflict') this.panel.set(null);
  }

  protected replaceTheirs(): void {
    const theirs = this.conflict();
    if (theirs !== null) void this.save(theirs.version);
  }

  protected async copyMine(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.form().body);
      this.toasts.show('Copiamos tu texto.');
    } catch {
      this.toasts.show('No pudimos copiar el texto.', 'err');
    }
  }

  private async save(version: number): Promise<void> {
    if (this.saving()) return;
    const errors = validateMemoryForm(this.form());
    if (errorCount(errors) > 0) {
      this.errors.set(errors);
      this.live.announce(`Revisa los campos marcados: ${errorCount(errors)} por corregir.`);
      setTimeout(() => this.summaryRef()?.nativeElement.focus());
      return;
    }
    this.saving.set(true);
    try {
      const request = memoryRequestFrom(this.form());
      const saved =
        this.memoryId === null
          ? await this.api.create(request)
          : await this.api.update(this.memoryId, { ...request, version });
      this.adopt(saved);
      this.panel.set(null);
      this.toasts.show(
        this.memoryId === null ? 'Guardamos este momento.' : 'Guardamos los cambios.',
        'cats',
      );
      await this.router.navigate(['/app/timeline', saved.memoryId], { replaceUrl: true });
    } catch (error) {
      await this.handleSaveFailure(error);
    } finally {
      this.saving.set(false);
    }
  }

  private async handleSaveFailure(error: unknown): Promise<void> {
    if (isConflict(error) && this.memoryId !== null) {
      try {
        this.conflict.set(await this.api.get(this.memoryId));
        this.conflictOpen.set(false);
        this.panel.set('conflict');
        this.live.announce('Este recuerdo cambió mientras escribías.');
        return;
      } catch (reloadError) {
        error = reloadError;
      }
    }
    this.toasts.show(
      failureMessage(error, 'No pudimos guardar el cambio. Tu texto sigue aquí.'),
      'err',
    );
  }

  private adopt(memory: MemoryDto): void {
    const form = memoryFormFrom(memory);
    this.version = memory.version;
    this.form.set(form);
    this.savedKey.set(memoryFormKey(form));
    this.errors.set({});
  }

  private clearError(field: MemoryField): void {
    if (this.errors()[field] === undefined) return;
    this.errors.update((errors) => {
      const next = { ...errors };
      delete next[field];
      return next;
    });
  }
}
