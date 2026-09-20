import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from './auth/auth.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main class="grid min-h-screen place-items-center bg-ink text-cream">
    Completing sign-in…
  </main>`,
})
export class AuthCallbackComponent {
  private readonly auth = inject(AuthService);

  public constructor() {
    void this.auth.completeLogin();
  }
}
