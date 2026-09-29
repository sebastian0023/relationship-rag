import { Injectable, computed, signal } from '@angular/core';
import { cardFormKey, isCardFormDirty, type CardFormValue } from './card-form.js';

interface DraftBuffer {
  readonly cardId: string;
  readonly version: number;
  readonly form: CardFormValue;
  readonly savedKey: string;
}

/**
 * Keeps the text of a saved draft that is being edited, so going from the editor to the review
 * screen and back never loses it, and the review screen knows when the saved version is stale.
 * It lives in memory only; nothing is written to browser storage.
 */
@Injectable({ providedIn: 'root' })
export class CardDraftStore {
  private readonly buffer = signal<DraftBuffer | null>(null);

  public readonly current = this.buffer.asReadonly();
  public readonly dirty = computed(() => {
    const buffer = this.buffer();
    return buffer !== null && isCardFormDirty(buffer.form, buffer.savedKey);
  });

  public forCard(cardId: string): DraftBuffer | null {
    const buffer = this.buffer();
    return buffer?.cardId === cardId ? buffer : null;
  }

  public edit(cardId: string, version: number, form: CardFormValue, savedKey: string): void {
    this.buffer.set({ cardId, version, form, savedKey });
  }

  public saved(cardId: string, version: number, form: CardFormValue): void {
    this.buffer.set({ cardId, version, form, savedKey: cardFormKey(form) });
  }

  public clear(): void {
    this.buffer.set(null);
  }
}
