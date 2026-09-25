import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./login.component.js').then((module) => module.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./auth-callback.component.js').then((module) => module.AuthCallbackComponent),
  },
  {
    path: 'app',
    loadChildren: () =>
      import('./authenticated.routes.js').then((module) => module.authenticatedRoutes),
  },
  { path: '**', redirectTo: 'app' },
];
