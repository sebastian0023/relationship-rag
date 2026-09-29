import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from './icon.component.js';

/** Loading skeleton and the error block shared by the memory, card, and inbox lists. */
@Component({
  selector: 'nh-lista-estado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (state() === 'loading') {
      <div role="status" aria-busy="true" class="flex flex-col gap-3">
        <span class="font-texto text-[15px] font-medium text-ciruela-suave">{{
          loadingLabel()
        }}</span>
        <div class="h-[120px] rounded-[14px] bg-[#F1E8DE]"></div>
        <div class="h-[120px] rounded-[14px] bg-[#F4ECE3]"></div>
      </div>
    } @else {
      <div
        role="alert"
        class="flex flex-col items-center gap-3 rounded-2xl border border-borde bg-papel px-4 py-7 text-center"
      >
        <span class="text-[#8A2B25]"><nh-icon name="alert" /></span>
        <h2 class="m-0 font-titulo text-[22px] font-medium">{{ errorTitle() }}</h2>
        <p class="m-0 font-texto text-[15px] leading-normal text-ciruela-medio">
          {{ errorMessage() }}
        </p>
        <button type="button" class="nh-btn nh-btn-secundario" (click)="retry.emit()">
          <nh-icon name="refresh" />Reintentar
        </button>
        @if (reference()) {
          <span class="font-texto text-[12.5px] text-ciruela-suave"
            >Referencia: {{ reference() }}</span
          >
        }
      </div>
    }
  `,
})
export class ListaEstadoComponent {
  public readonly state = input.required<'loading' | 'error'>();
  public readonly loadingLabel = input('Cargando…');
  public readonly errorTitle = input('No pudimos cargar esta lista');
  public readonly errorMessage = input(
    'Revisa tu conexión e inténtalo de nuevo. Nada se ha perdido.',
  );
  public readonly reference = input<string>();
  public readonly retry = output<void>();
}
