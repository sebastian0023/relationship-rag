import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from './ui/icon.component.js';

/** Shown for inactive memberships. It reveals nothing about the account or the space. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  template: `<main
    class="nh-textura flex min-h-dvh flex-col items-center justify-center gap-[18px] p-7 text-center"
  >
    <span class="flex size-16 items-center justify-center rounded-full bg-rosa text-ciruela"
      ><nh-icon name="lock"
    /></span>
    <h1 class="m-0 font-titulo text-[28px] font-medium leading-[1.2]">Este espacio es privado</h1>
    <p class="m-0 max-w-[330px] text-base leading-[1.55] text-ciruela-medio">
      La cuenta con la que entraste no tiene acceso a Nuestra historia. Si crees que es un error,
      pide a quien te invitó que revise la invitación.
    </p>
    <a routerLink="/login" class="nh-btn nh-btn-primario min-h-[52px] px-7 text-base"
      >Volver a la bienvenida</a
    >
  </main>`,
})
export class AccessDeniedComponent {}
