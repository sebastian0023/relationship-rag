import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth/auth.service.js';
import { ToastService } from './ui/avisos.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main
    role="status"
    class="nh-textura flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center text-accion"
  >
    <span class="nh-giro" aria-hidden="true"></span>
    <p class="m-0 font-titulo text-[22px] font-medium text-ciruela">Completando el acceso…</p>
  </main>`,
})
export class AuthCallbackComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  public constructor() {
    void this.complete();
  }

  private async complete(): Promise<void> {
    await this.auth.completeLogin();
    const state = this.auth.state();
    if (state === 'authenticated') {
      this.toasts.show(`Hola de nuevo, ${this.auth.profile()?.displayName ?? ''}.`);
    } else if (state === 'denied') {
      await this.router.navigateByUrl('/access-denied');
    } else {
      this.toasts.show('No pudimos completar el acceso. Inténtalo de nuevo.', 'err');
      await this.router.navigateByUrl('/login');
    }
  }
}
