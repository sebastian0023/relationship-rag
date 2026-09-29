import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Browser connectivity, for the «Se interrumpió la conexión» banner. */
@Injectable({ providedIn: 'root' })
export class NetworkStatus {
  public readonly online = signal(navigator.onLine);

  public constructor() {
    const update = () => this.online.set(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}

const KEYBOARD_THRESHOLD_PX = 150;

/**
 * Whether the on-screen keyboard covers part of the layout viewport. While it is open the bottom
 * navigation hides so the focused field and the question box stay visible.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardInset {
  public readonly open = signal(false);

  public constructor() {
    const viewport = window.visualViewport;
    if (viewport === null || viewport === undefined) return;
    const update = () =>
      this.open.set(window.innerHeight - viewport.height > KEYBOARD_THRESHOLD_PX);
    viewport.addEventListener('resize', update);
    inject(DestroyRef).onDestroy(() => viewport.removeEventListener('resize', update));
  }
}

/** `prefers-reduced-motion`, for behaviour that CSS alone cannot skip (timers). */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
