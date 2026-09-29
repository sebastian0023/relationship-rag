import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService, SIGNED_OUT_FLAG } from './auth/auth.service.js';
import { ToastService } from './ui/avisos.service.js';
import { GatitosComponent } from './ui/gatitos.component.js';
import { IconComponent } from './ui/icon.component.js';

/** Welcome page. Sign-in itself happens on the Cognito-hosted page. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GatitosComponent, IconComponent],
  template: `
    <main class="nh-textura flex min-h-dvh flex-col">
      @if (redirecting()) {
        <div
          role="status"
          class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-accion"
        >
          <span class="nh-giro" aria-hidden="true"></span>
          <p class="m-0 font-titulo text-[22px] font-medium text-ciruela">
            Te llevamos al acceso seguro…
          </p>
          <p class="m-0 max-w-[300px] text-[15px] leading-normal text-ciruela-suave">
            Vas a entrar en una página de acceso protegida. Después volverás aquí.
          </p>
        </div>
      } @else {
        <div
          class="mx-auto grid w-full max-w-[1120px] flex-1 items-center gap-7 px-5 pb-8 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:px-16 lg:py-14"
        >
          <div
            class="relative rotate-[-1.2deg] rounded-[20px] bg-papel px-[22px] pb-[22px] pt-[34px] shadow-[0_1px_2px_rgba(56,43,54,.06),0_10px_30px_rgba(56,43,54,.08)] lg:order-2"
          >
            <span
              aria-hidden="true"
              class="absolute left-1/2 top-[-11px] -ml-12 h-6 w-24 rotate-2 rounded-[3px] bg-[rgba(244,215,181,.85)]"
            ></span>
            <div class="rounded-[14px] bg-[#F7EFE6] px-2.5 pb-2.5 pt-[22px]">
              <nh-gatitos name="rest" width="100%" />
            </div>
            <p
              class="mx-1 mb-0 mt-3.5 text-center font-titulo text-base italic leading-snug text-ciruela-medio"
            >
              Aquí se guarda lo nuestro.
            </p>
          </div>
          <div class="flex flex-col gap-[22px]">
            <div class="flex items-center gap-2.5 text-accion">
              <nh-icon name="heart" /><span class="font-titulo text-xl font-medium text-ciruela"
                >Nuestra historia</span
              >
            </div>
            <h1
              class="m-0 text-balance font-titulo text-[36px] font-medium leading-[1.1] tracking-[-.01em] lg:text-[52px]"
            >
              Un lugar para guardar lo que somos.
            </h1>
            <ul class="m-0 flex list-none flex-col gap-3.5 p-0">
              <li class="flex items-start gap-3.5">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rosa"
                  ><nh-icon name="album"
                /></span>
                <span class="text-base leading-normal text-ciruela-medio"
                  ><b class="font-semibold text-ciruela">Recuerdos</b> con fecha, lugar y
                  fotografías, en un álbum que escriben entre los dos.</span
                >
              </li>
              <li class="flex items-start gap-3.5">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-salvia"
                  ><nh-icon name="chat"
                /></span>
                <span class="text-base leading-normal text-ciruela-medio"
                  ><b class="font-semibold text-ciruela">Conversaciones</b> para preguntar sobre su
                  historia y volver a lo que guardaron.</span
                >
              </li>
              <li class="flex items-start gap-3.5">
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-lavanda"
                  ><nh-icon name="mail"
                /></span>
                <span class="text-base leading-normal text-ciruela-medio"
                  ><b class="font-semibold text-ciruela">Tarjetas</b> para escribirse y leerlas con
                  calma, cuando lleguen.</span
                >
              </li>
            </ul>
            <button
              type="button"
              class="nh-btn nh-btn-primario min-h-[52px] px-7 text-[17px]"
              (click)="enter()"
            >
              Entrar a nuestro espacio
            </button>
            @if (auth.state() === 'unavailable') {
              <p role="status" class="nh-error-campo">
                <nh-icon name="alert" />El acceso no está disponible en este entorno.
              </p>
            }
            <p class="m-0 flex items-center gap-2 text-sm leading-snug text-ciruela-suave">
              <nh-icon name="lock" />Espacio privado. Solo se entra por invitación.
            </p>
          </div>
        </div>
      }
    </main>
  `,
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(ToastService);
  protected readonly redirecting = signal(false);

  public constructor() {
    if (sessionStorage.getItem(SIGNED_OUT_FLAG) !== null) {
      sessionStorage.removeItem(SIGNED_OUT_FLAG);
      this.toasts.show('Cerraste sesión. Hasta pronto.');
    }
  }

  protected async enter(): Promise<void> {
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
