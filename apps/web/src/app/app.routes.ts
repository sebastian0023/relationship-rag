import type { Routes } from '@angular/router';
import { authenticatedGuard } from './auth/auth.guard.js';
import { AppShellComponent } from './app-shell.component.js';
import { AuthCallbackComponent } from './auth-callback.component.js';
import { LoginComponent } from './login.component.js';
import { TimelineComponent } from './timeline.component.js';
import { MemoryEditorComponent } from './memory-editor.component.js';
import { MemoryDetailComponent } from './memory-detail.component.js';
import { ChatComponent } from './chat.component.js';
import { CardListComponent } from './card-list.component.js';
import { CardEditorComponent } from './card-editor.component.js';
import { InboxComponent } from './inbox.component.js';
import { InboxDetailComponent } from './inbox-detail.component.js';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  {
    path: 'app',
    component: AppShellComponent,
    canActivate: [authenticatedGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'timeline' },
      { path: 'timeline', component: TimelineComponent },
      { path: 'timeline/new', component: MemoryEditorComponent },
      { path: 'timeline/:memoryId', component: MemoryDetailComponent },
      { path: 'timeline/:memoryId/edit', component: MemoryEditorComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'chat/:conversationId', component: ChatComponent },
      { path: 'cards', component: CardListComponent },
      { path: 'cards/new', component: CardEditorComponent },
      { path: 'cards/:cardId', component: CardEditorComponent },
      { path: 'inbox', component: InboxComponent },
      { path: 'inbox/:cardId', component: InboxDetailComponent },
    ],
  },
  { path: '**', redirectTo: 'app' },
];
