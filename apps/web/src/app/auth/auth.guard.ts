import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service.js';

export const authenticatedGuard: CanActivateFn = async (_route, routerState) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.restore();
  if (auth.state() === 'authenticated') return true;
  if (auth.state() === 'unavailable') {
    return router.createUrlTree(['/login'], { queryParams: { returnTo: routerState.url } });
  }
  await auth.startLogin(routerState.url);
  return false;
};
