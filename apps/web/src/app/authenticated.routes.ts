import type { Routes } from '@angular/router';
import { authenticatedGuard } from './auth/auth.guard.js';

export const authenticatedRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./app-shell.component.js').then((module) => module.AppShellComponent),
    canActivate: [authenticatedGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'timeline' },
      {
        path: 'timeline',
        loadComponent: () =>
          import('./timeline.component.js').then((module) => module.TimelineComponent),
      },
      {
        path: 'timeline/new',
        loadComponent: () =>
          import('./memory-editor.component.js').then((module) => module.MemoryEditorComponent),
      },
      {
        path: 'timeline/:memoryId',
        loadComponent: () =>
          import('./memory-detail.component.js').then((module) => module.MemoryDetailComponent),
      },
      {
        path: 'timeline/:memoryId/edit',
        loadComponent: () =>
          import('./memory-editor.component.js').then((module) => module.MemoryEditorComponent),
      },
      {
        path: 'chat',
        loadComponent: () => import('./chat.component.js').then((module) => module.ChatComponent),
      },
      {
        path: 'chat/:conversationId',
        loadComponent: () => import('./chat.component.js').then((module) => module.ChatComponent),
      },
      {
        path: 'cards',
        loadComponent: () =>
          import('./card-list.component.js').then((module) => module.CardListComponent),
      },
      {
        path: 'cards/new',
        loadComponent: () =>
          import('./card-editor.component.js').then((module) => module.CardEditorComponent),
      },
      {
        path: 'cards/:cardId',
        loadComponent: () =>
          import('./card-editor.component.js').then((module) => module.CardEditorComponent),
      },
      {
        path: 'inbox',
        loadComponent: () => import('./inbox.component.js').then((module) => module.InboxComponent),
      },
      {
        path: 'inbox/:cardId',
        loadComponent: () =>
          import('./inbox-detail.component.js').then((module) => module.InboxDetailComponent),
      },
    ],
  },
];
