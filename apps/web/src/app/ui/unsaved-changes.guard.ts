import type { CanDeactivateFn } from '@angular/router';

/** A screen that may hold unsaved text and asks before it is discarded. */
export interface GuardsUnsavedChanges {
  /** `nextUrl` lets a screen allow destinations that keep its unsaved text. */
  canLeave(nextUrl: string): boolean | Promise<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<GuardsUnsavedChanges> = (
  component,
  _route,
  _state,
  next,
) => component.canLeave(next.url);

/**
 * The «¿Salir sin guardar?» decision: resolves `true` to discard or `false` to keep editing.
 * A newer request answers any pending one with `false`.
 */
export class LeaveDecision {
  private resolve: ((leave: boolean) => void) | undefined;

  public ask(): Promise<boolean> {
    this.resolve?.(false);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  public answer(leave: boolean): void {
    this.resolve?.(leave);
    this.resolve = undefined;
  }

  public get pending(): boolean {
    return this.resolve !== undefined;
  }
}
