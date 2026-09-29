import { Injectable, inject, signal } from '@angular/core';

export type ToastKind = 'ok' | 'err' | 'cats';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly kind: ToastKind;
}

const TOAST_DURATION_MS = 3600;

/** One polite live region for saves, uploads, answers, and read receipts. */
@Injectable({ providedIn: 'root' })
export class LiveAnnouncer {
  public readonly message = signal('');

  public announce(message: string): void {
    this.message.set('');
    setTimeout(() => this.message.set(message), 50);
  }
}

/** Brief confirmation or failure notices. Every toast is also announced to assistive technology. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  public readonly current = signal<Toast | null>(null);
  private readonly live = inject(LiveAnnouncer);
  private nextId = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public show(message: string, kind: ToastKind = 'ok'): void {
    const toast = { id: ++this.nextId, message, kind };
    this.current.set(toast);
    this.live.announce(message);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.current()?.id === toast.id) this.current.set(null);
    }, TOAST_DURATION_MS);
  }

  public dismiss(): void {
    clearTimeout(this.timer);
    this.current.set(null);
  }
}
