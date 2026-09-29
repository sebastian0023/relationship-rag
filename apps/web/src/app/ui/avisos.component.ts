import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GatitosComponent } from './gatitos.component.js';
import { IconComponent } from './icon.component.js';
import { LiveAnnouncer, ToastService } from './avisos.service.js';
import { LayoutState } from './layout-state.service.js';

/** Global toast host and the single polite live region. */
@Component({
  selector: 'nh-avisos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent, IconComponent],
  template: `
    <div aria-live="polite" class="sr-only">{{ live.message() }}</div>
    @if (toasts.current(); as toast) {
      <div
        class="pointer-events-none fixed inset-x-3 z-40 flex justify-center"
        [class]="
          layout.bottomChrome() === 'nav'
            ? 'bottom-[calc(96px+env(safe-area-inset-bottom))] md:bottom-6'
            : layout.bottomChrome() === 'bar'
              ? 'bottom-[calc(100px+env(safe-area-inset-bottom))]'
              : 'bottom-6'
        "
      >
        <div
          class="pointer-events-auto flex max-w-[440px] items-center gap-2.5 rounded-2xl border py-2.5 pl-3.5 pr-3 font-texto text-[15px] font-medium leading-snug shadow-[0_10px_30px_rgba(46,35,48,.25)] [animation:nhPop_.2s_ease-out]"
          [class]="
            toast.kind === 'err'
              ? 'border-[#E9B1AA] bg-[#FFF1EF] text-[#8A2B25]'
              : 'border-ciruela bg-ciruela text-papel'
          "
        >
          @switch (toast.kind) {
            @case ('cats') {
              <span class="w-16 shrink-0 rounded-[10px] bg-marfil px-0.5 pt-1">
                <nh-gatitos name="react" width="64px" />
              </span>
            }
            @case ('err') {
              <nh-icon name="alert" />
            }
            @default {
              <nh-icon name="check" />
            }
          }
          <span class="flex-1">{{ toast.message }}</span>
          <button
            type="button"
            class="flex size-10 items-center justify-center rounded-full"
            aria-label="Cerrar aviso"
            (click)="toasts.dismiss()"
          >
            <nh-icon name="close" />
          </button>
        </div>
      </div>
    }
  `,
})
export class AvisosComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly live = inject(LiveAnnouncer);
  protected readonly layout = inject(LayoutState);
}
