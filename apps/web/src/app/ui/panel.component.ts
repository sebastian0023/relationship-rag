import {
  ChangeDetectionStrategy,
  Component,
  effect,
  input,
  output,
  viewChild,
  type ElementRef,
} from '@angular/core';

/**
 * Modal panel built on the native `<dialog>`: a bottom sheet on phones, a centred dialog from
 * 1024 px, or a full-screen viewer. The dialog traps focus, closes on Escape or backdrop click, and
 * returns focus to the control that opened it.
 */
@Component({
  selector: 'nh-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<dialog
    #dialog
    class="nh-panel"
    [class.nh-panel-completo]="variant() === 'full'"
    [attr.aria-labelledby]="labelledBy() ?? null"
    [attr.aria-label]="label() ?? null"
    (close)="onNativeClose()"
    (click)="onDialogClick($event)"
  >
    <div class="nh-panel-contenido">
      @if (variant() === 'sheet') {
        <div aria-hidden="true" class="mx-auto mb-3 h-[5px] w-10 rounded-full bg-campo"></div>
      }
      <ng-content />
    </div>
  </dialog>`,
})
export class PanelComponent {
  public readonly open = input.required<boolean>();
  public readonly labelledBy = input<string>();
  public readonly label = input<string>();
  public readonly variant = input<'sheet' | 'full'>('sheet');
  public readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private opener: HTMLElement | null = null;

  public constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open() && !dialog.open) {
        this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      } else if (!this.open() && dialog.open) {
        dialog.close();
      }
    });
  }

  protected onNativeClose(): void {
    this.closed.emit();
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus();
  }

  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.dialog().nativeElement.close();
  }
}
