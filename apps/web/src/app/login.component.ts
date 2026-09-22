import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from './auth/auth.service.js';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen overflow-hidden bg-ink text-cream">
      <div class="pointer-events-none absolute inset-0 opacity-30" aria-hidden="true">
        <div class="glow left-[8%] top-[-12rem]"></div>
        <div class="glow bottom-[-14rem] right-[4%] bg-rose/25"></div>
      </div>
      <nav class="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-7 lg:px-10">
        <span class="font-display text-xl tracking-tight"
          >Our story<span class="text-rose">.</span></span
        >
        <span
          class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-cream/60"
          >Private by design</span
        >
      </nav>
      <section
        class="relative mx-auto grid min-h-[calc(100vh-90px)] max-w-7xl items-center gap-16 px-6 pb-24 pt-12 lg:grid-cols-[1.08fr_0.92fr] lg:px-10"
      >
        <div class="max-w-3xl">
          <p class="mb-6 text-sm font-medium uppercase tracking-[0.28em] text-rose">
            Two people · one archive
          </p>
          <h1
            class="font-display text-5xl leading-[0.98] tracking-[-0.04em] sm:text-7xl lg:text-8xl"
          >
            Remember the moments that made you <span class="italic text-rose">us.</span>
          </h1>
          <p class="mt-8 max-w-xl text-lg leading-8 text-cream/65">
            A quiet place for your timeline, thoughtful conversations grounded in your memories, and
            cards worth keeping.
          </p>
          <div class="mt-10 flex flex-wrap items-center gap-4">
            <button
              class="rounded-full bg-rose px-6 py-3 text-sm font-semibold text-ink"
              (click)="signIn()"
            >
              Sign in with your invitation
            </button>
            @if (auth.state() === 'unavailable') {
              <span class="text-sm text-rose" role="status"
                >Sign-in configuration is not available in this environment.</span
              >
            }
          </div>
        </div>
        <aside class="relative mx-auto w-full max-w-md" aria-label="Product preview">
          <div
            class="rotate-2 rounded-[2rem] border border-white/10 bg-paper p-3 text-ink shadow-2xl shadow-black/30"
          >
            <div class="rounded-[1.45rem] border border-ink/10 p-7 sm:p-9">
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-wine">
                May 14 · Puerto Vallarta
              </p>
              <h2 class="mt-5 font-display text-4xl leading-tight">
                The trip where everything slowed down.
              </h2>
              <p class="mt-5 text-sm leading-6 text-ink/75">
                Morning coffee by the water, the long walk after sunset, and the story we still tell
                the same way.
              </p>
              <div class="mt-10 flex items-end justify-between border-t border-ink/10 pt-5">
                <span class="font-display text-lg italic text-wine">A shared memory</span>
                <span class="rounded-full bg-wine/10 px-3 py-1 text-xs font-medium text-wine"
                  >Travel</span
                >
              </div>
            </div>
          </div>
          <div
            class="absolute -bottom-7 -left-5 -z-10 hidden h-full w-full -rotate-3 rounded-[2rem] border border-rose/20 sm:block"
          ></div>
        </aside>
      </section>
    </main>
  `,
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  protected signIn(): Promise<void> {
    return this.auth.startLogin(this.route.snapshot.queryParamMap.get('returnTo') ?? '/app');
  }
}
