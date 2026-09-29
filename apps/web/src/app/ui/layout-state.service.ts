import { Injectable, signal } from '@angular/core';

/** What sits at the bottom of the viewport, so floating notices can clear it. */
export type BottomChrome = 'none' | 'nav' | 'bar';

@Injectable({ providedIn: 'root' })
export class LayoutState {
  public readonly bottomChrome = signal<BottomChrome>('none');
}
