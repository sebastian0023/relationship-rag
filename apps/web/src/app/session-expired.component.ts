import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from './auth/auth.service.js';
import { ToastService } from './ui/avisos.service.js';
import { GatitosComponent } from './ui/gatitos.component.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent],
  template: `<main
    class="nh-textura flex min-h-dvh flex-col items-center justify-center gap-[18px] p-7 text-center"
  >
    @if (redirecting()) {
      <div role="status" class="flex flex-col items-center gap-4 text-accion">
        <span class="nh-giro" aria-hidden="true"></span>
        <p class="m-0 font-titulo text-[22px] font-medium text-ciruela">
          Te llevamos al acceso seguro…
        </p>
      </div>
    } @else {
      <nh-gatitos name="sleep" width="210px" />
      <h1 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">Tu sesión terminó</h1>
      <p class="m-0 max-w-[320px] text-base leading-[1.55] text-ciruela-medio">
        Por seguridad, cerramos la sesión después de un tiempo sin actividad. Todo lo que guardaron
        sigue aquí.
      </p>
      <p class="m-0 max-w-[320px] text-sm leading-normal text-ciruela-suave">
        Si estabas escribiendo algo sin guardar, es posible que no se haya conservado.
      </p>
      <button
        type="button"
        class="nh-btn nh-btn-primario min-h-[52px] px-7 text-base"
        (click)="signInAgain()"
      >
        Volver a entrar
      </button>
    }
  </main>`,
})
export class SessionExpiredComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  protected readonly redirecting = signal(false);

  protected async signInAgain(): Promise<void> {
    this.redirecting.set(true);
    try {
      await this.auth.startLogin(this.route.snapshot.queryParamMap.get('returnTo') ?? '/app');
      if (this.auth.state() === 'unavailable') this.redirecting.set(false);
    } catch {
      this.redirecting.set(false);
      this.toasts.show('No pudimos abrir el acceso seguro. Inténtalo de nuevo.', 'err');
    }
  }
}
