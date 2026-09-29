import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICON_PATHS, type IconName } from './icons.js';

/** Decorative icon. Actions that use it always carry a visible label or an accessible name. */
@Component({
  selector: 'nh-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'inline-flex shrink-0' },
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    class="block"
  >
    @for (d of paths(); track $index) {
      <path [attr.d]="d" />
    }
  </svg>`,
})
export class IconComponent {
  public readonly name = input.required<IconName>();
  public readonly size = input(20);
  protected readonly paths = computed(() => ICON_PATHS[this.name()]);
}
