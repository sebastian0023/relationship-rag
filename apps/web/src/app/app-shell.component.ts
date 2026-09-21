import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet],
  template: `
    <main class="min-h-screen bg-ink px-6 py-7 text-cream lg:px-10">
      <nav class="mx-auto flex max-w-7xl items-center justify-between">
        <span class="font-display text-xl">Our story<span class="text-rose">.</span></span>
        <div class="flex items-center gap-4 text-sm">
          <a routerLink="/app/timeline">Timeline</a>
          <a routerLink="/app/chat">Chat</a>
          <span>{{ auth.profile()?.displayName }} · {{ auth.profile()?.role }}</span>
          <button class="rounded-full border border-white/15 px-4 py-2" (click)="signOut()">
            Sign out
          </button>
        </div>
      </nav>
      <router-outlet />
    </main>
  `,
})
export class AppShellComponent {
  protected readonly auth = inject(AuthService);

  protected signOut(): Promise<void> {
    return this.auth.signOut();
  }
}
