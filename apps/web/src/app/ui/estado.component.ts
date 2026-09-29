import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { CardStatus } from '@relationship-rag/contracts';
import { IconComponent } from './icon.component.js';
import { AI_AVAILABILITY, CARD_STATUS, type IngestionStatus, type StatusStyle } from './status.js';

/** Status pill: icon plus text, never colour alone. */
@Component({
  selector: 'nh-estado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'inline-flex self-start' },
  template: `<span
    class="inline-flex items-center gap-1.5 rounded-full font-texto font-semibold"
    [class]="large() ? 'py-[5px] pl-[9px] pr-3 text-sm' : 'py-1 pl-2 pr-2.5 text-[12.5px]'"
    [style.background]="style().background"
    [style.color]="style().foreground"
    ><nh-icon [name]="style().icon" [size]="large() ? 20 : 18" />{{ style().label }}</span
  >`,
})
export class EstadoComponent {
  public readonly ai = input<IngestionStatus>();
  public readonly card = input<CardStatus>();
  public readonly large = input(false);

  protected readonly style = computed<StatusStyle>(() => {
    const card = this.card();
    if (card !== undefined) return CARD_STATUS[card];
    return AI_AVAILABILITY[this.ai() ?? 'NOT_REQUESTED'];
  });
}
