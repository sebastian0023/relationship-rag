import type { Routes } from '@angular/router';
import { authenticatedGuard } from './auth/auth.guard.js';
import { AppShellComponent } from './app-shell.component.js';
import { AuthCallbackComponent } from './auth-callback.component.js';
import { LoginComponent } from './login.component.js';
import { TimelineComponent } from './timeline.component.js';
import { MemoryEditorComponent } from './memory-editor.component.js';
import { MemoryDetailComponent } from './memory-detail.component.js';

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
    ],
  },
  { path: '**', redirectTo: 'app' },
];
