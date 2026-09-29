import type { Routes, UrlMatcher } from '@angular/router';
import { authenticatedGuard } from './auth/auth.guard.js';
import { unsavedChangesGuard } from './ui/unsaved-changes.guard.js';
import type { ShellRouteData } from './app-shell.component.js';

const shell = (data: ShellRouteData): ShellRouteData => data;

/**
 * `chat` and `chat/:conversationId` share one route so the conversation screen survives the
 * navigation that follows creating a conversation on the first question.
 */
export const chatMatcher: UrlMatcher = (segments) => {
  const [first, id, ...rest] = segments;
  if (first?.path !== 'chat' || rest.length > 0) return null;
  return { consumed: segments, posParams: id === undefined ? {} : { conversationId: id } };
};

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
        matcher: chatMatcher,
        title: 'Conversar · Nuestra historia',
        data: shell({ tab: 'chat', fill: true }),
        loadComponent: () => import('./chat.component.js').then((m) => m.ChatComponent),
      },
      {
        path: 'cards',
        title: 'Tarjetas · Nuestra historia',
        data: shell({ tab: 'cards' }),
        loadComponent: () => import('./card-list.component.js').then((m) => m.CardListComponent),
      },
      {
        // `new` is a card ID placeholder, so saving a new draft keeps the same editor instance.
        path: 'cards/:cardId',
        title: 'Tarjeta · Nuestra historia',
        data: shell({ tab: 'cards', subpage: true, bottomBar: true }),
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./card-editor.component.js').then((m) => m.CardEditorComponent),
      },
      {
        path: 'cards/:cardId/review',
        title: 'Revisar envío · Nuestra historia',
        data: shell({ tab: 'cards', subpage: true }),
        loadComponent: () =>
          import('./card-review.component.js').then((m) => m.CardReviewComponent),
      },
      {
        path: 'cards/:cardId/view',
        title: 'Tarjeta enviada · Nuestra historia',
        data: shell({ tab: 'cards', subpage: true }),
        loadComponent: () => import('./card-view.component.js').then((m) => m.CardViewComponent),
      },
      {
        path: 'inbox',
        title: 'Buzón · Nuestra historia',
        data: shell({ tab: 'inbox' }),
        loadComponent: () => import('./inbox.component.js').then((m) => m.InboxComponent),
      },
      {
        path: 'inbox/:cardId',
        title: 'Tarjeta recibida · Nuestra historia',
        data: shell({ tab: 'inbox', subpage: true }),
        loadComponent: () =>
          import('./inbox-detail.component.js').then((m) => m.InboxDetailComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'app' },
];
