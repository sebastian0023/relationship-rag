import type { Routes } from '@angular/router';
import { authenticatedGuard } from './auth/auth.guard.js';
import { unsavedChangesGuard } from './ui/unsaved-changes.guard.js';
import type { ShellRouteData } from './app-shell.component.js';

const shell = (data: ShellRouteData): ShellRouteData => data;

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    title: 'Nuestra historia',
    loadComponent: () => import('./login.component.js').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    title: 'Nuestra historia',
    loadComponent: () =>
      import('./auth-callback.component.js').then((m) => m.AuthCallbackComponent),
  },
  {
    path: 'session-expired',
    title: 'Tu sesión terminó · Nuestra historia',
    loadComponent: () =>
      import('./session-expired.component.js').then((m) => m.SessionExpiredComponent),
  },
  {
    path: 'access-denied',
    title: 'Este espacio es privado · Nuestra historia',
    loadComponent: () =>
      import('./access-denied.component.js').then((m) => m.AccessDeniedComponent),
  },
  {
    path: 'app',
    loadComponent: () => import('./app-shell.component.js').then((m) => m.AppShellComponent),
    canActivate: [authenticatedGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'timeline' },
      {
        path: 'timeline',
        title: 'Recuerdos · Nuestra historia',
        data: shell({ tab: 'timeline' }),
        loadComponent: () => import('./timeline.component.js').then((m) => m.TimelineComponent),
      },
      {
        path: 'timeline/new',
        title: 'Nuevo recuerdo · Nuestra historia',
        data: shell({ tab: 'timeline', subpage: true, bottomBar: true }),
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./memory-editor.component.js').then((m) => m.MemoryEditorComponent),
      },
      {
        path: 'timeline/:memoryId',
        title: 'Recuerdo · Nuestra historia',
        data: shell({ tab: 'timeline', subpage: true }),
        loadComponent: () =>
          import('./memory-detail.component.js').then((m) => m.MemoryDetailComponent),
      },
      {
        path: 'timeline/:memoryId/edit',
        title: 'Editar recuerdo · Nuestra historia',
        data: shell({ tab: 'timeline', subpage: true, bottomBar: true }),
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./memory-editor.component.js').then((m) => m.MemoryEditorComponent),
      },
      {
        path: 'chat',
        title: 'Conversar · Nuestra historia',
        data: shell({ tab: 'chat', legacy: true }),
        loadComponent: () => import('./chat.component.js').then((m) => m.ChatComponent),
      },
      {
        path: 'chat/:conversationId',
        title: 'Conversar · Nuestra historia',
        data: shell({ tab: 'chat', legacy: true }),
        loadComponent: () => import('./chat.component.js').then((m) => m.ChatComponent),
      },
      {
        path: 'cards',
        title: 'Tarjetas · Nuestra historia',
        data: shell({ tab: 'cards', legacy: true }),
        loadComponent: () => import('./card-list.component.js').then((m) => m.CardListComponent),
      },
      {
        path: 'cards/new',
        title: 'Nueva tarjeta · Nuestra historia',
        data: shell({ tab: 'cards', subpage: true, legacy: true }),
        loadComponent: () =>
          import('./card-editor.component.js').then((m) => m.CardEditorComponent),
      },
      {
        path: 'cards/:cardId',
        title: 'Tarjeta · Nuestra historia',
        data: shell({ tab: 'cards', subpage: true, legacy: true }),
        loadComponent: () =>
          import('./card-editor.component.js').then((m) => m.CardEditorComponent),
      },
      {
        path: 'inbox',
        title: 'Buzón · Nuestra historia',
        data: shell({ tab: 'inbox', legacy: true }),
        loadComponent: () => import('./inbox.component.js').then((m) => m.InboxComponent),
      },
      {
        path: 'inbox/:cardId',
        title: 'Tarjeta recibida · Nuestra historia',
        data: shell({ tab: 'inbox', subpage: true, legacy: true }),
        loadComponent: () =>
          import('./inbox-detail.component.js').then((m) => m.InboxDetailComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'app' },
];
