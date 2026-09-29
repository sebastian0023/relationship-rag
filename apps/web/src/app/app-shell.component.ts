import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from './auth/auth.service.js';
import { InboxState } from './inbox-state.service.js';
import { initialOf } from './ui/format.js';
import { IconComponent } from './ui/icon.component.js';
import type { IconName } from './ui/icons.js';
import { LayoutState } from './ui/layout-state.service.js';
import { PanelComponent } from './ui/panel.component.js';
import { KeyboardInset, NetworkStatus } from './ui/platform.service.js';

export type NavTab = 'timeline' | 'chat' | 'cards' | 'inbox';

/** Route data that shapes the shell around a screen. */
export interface ShellRouteData {
  readonly tab: NavTab;
  /** A detail or form screen: on phones it replaces the header and bottom navigation. */
  readonly subpage?: boolean;
  /** The screen ends with a sticky action bar. */
  readonly bottomBar?: boolean;
  /** The screen manages its own scrolling (conversation). */
  readonly fill?: boolean;
  /** A screen not yet moved to the new design, rendered on its original dark surface. */
  readonly legacy?: boolean;
}

interface NavItem {
  readonly tab: NavTab;
  readonly label: string;
  readonly icon: IconName;
  readonly link: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { tab: 'timeline', label: 'Recuerdos', icon: 'album', link: '/app/timeline' },
  { tab: 'chat', label: 'Conversar', icon: 'chat', link: '/app/chat' },
  { tab: 'cards', label: 'Tarjetas', icon: 'pen', link: '/app/cards' },
  { tab: 'inbox', label: 'Buzón', icon: 'mail', link: '/app/inbox' },
];

const DEFAULT_DATA: ShellRouteData = { tab: 'timeline' };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PanelComponent, RouterLink, RouterOutlet],
  template: `
    <a class="skip-link" href="#contenido" (click)="focusContent($event)">Saltar al contenido</a>
    @if (signingOut()) {
      <div
        role="status"
        class="nh-textura fixed inset-0 z-50 flex flex-col items-center justify-center gap-3.5 text-accion"
      >
        <span class="nh-giro" aria-hidden="true"></span>
        <p class="m-0 font-titulo text-xl font-medium text-ciruela">Cerrando sesión…</p>
      </div>
    }
    <div class="nh-textura flex h-dvh">
      <nav
        aria-label="Secciones"
        class="hidden w-[236px] shrink-0 flex-col gap-1 border-r border-borde bg-[rgba(255,254,251,.75)] px-3.5 py-[22px] lg:flex"
      >
        <div class="flex items-center gap-2 px-2.5 pb-[22px] text-accion">
          <nh-icon name="heart" /><span class="font-titulo text-[21px] font-medium text-ciruela"
            >Nuestra historia</span
          >
        </div>
        @for (item of navItems; track item.tab) {
          <a
            [routerLink]="item.link"
            [attr.aria-current]="data().tab === item.tab ? 'page' : null"
            [attr.aria-label]="navLabel(item)"
            class="flex min-h-[46px] items-center gap-3 rounded-xl px-3 text-[15px] no-underline"
            [class]="
              data().tab === item.tab
                ? 'bg-rosa-claro font-bold text-ciruela'
                : 'font-medium text-ciruela-medio hover:bg-papel'
            "
          >
            <nh-icon [name]="item.icon" /><span class="flex-1">{{ item.label }}</span>
            @if (item.tab === 'inbox' && inbox.unread() > 0) {
              <span
                aria-hidden="true"
                class="h-[22px] min-w-[22px] rounded-full bg-accion px-1 text-center text-xs font-bold leading-[22px] text-papel"
                >{{ inbox.unread() }}</span
              >
            }
          </a>
        }
        <div class="flex-1"></div>
        <div class="flex items-center gap-2.5 border-t border-borde px-2.5 pt-3.5">
          <span
            aria-hidden="true"
            class="flex size-9 items-center justify-center rounded-full bg-rosa text-[15px] font-bold"
            >{{ initial() }}</span
          >
          <span class="flex-1 text-sm font-semibold"
            >{{ name()
            }}<span class="block text-[12.5px] font-normal text-ciruela-suave"
              >Sesión iniciada</span
            ></span
          >
        </div>
        <button
          type="button"
          class="flex min-h-11 items-center gap-2.5 px-3 text-sm font-semibold text-accion"
          (click)="signOut()"
        >
          <nh-icon name="logout" />Cerrar sesión
        </button>
      </nav>

      <nav
        aria-label="Secciones"
        class="hidden w-[92px] shrink-0 flex-col items-center gap-1 border-r border-borde bg-[rgba(255,254,251,.75)] py-4 md:flex lg:hidden"
      >
        <span class="pb-3 text-accion"><nh-icon name="heart" [size]="24" /></span>
        @for (item of navItems; track item.tab) {
          <a
            [routerLink]="item.link"
            [attr.aria-current]="data().tab === item.tab ? 'page' : null"
            [attr.aria-label]="navLabel(item)"
            class="flex min-h-[58px] w-full flex-col items-center justify-center gap-[3px] text-[12.5px] no-underline"
            [class]="
              data().tab === item.tab ? 'font-bold text-ciruela' : 'font-medium text-ciruela-medio'
            "
          >
            <span
              class="relative flex h-[30px] w-14 items-center justify-center rounded-full"
              [class.bg-rosa]="data().tab === item.tab"
              ><nh-icon [name]="item.icon" />
              @if (item.tab === 'inbox' && inbox.unread() > 0) {
                <span
                  aria-hidden="true"
                  class="absolute -top-0.5 right-1.5 h-[18px] min-w-[18px] rounded-full border-2 border-papel bg-accion text-center text-[11px] font-bold leading-[14px] text-papel"
                  >{{ inbox.unread() }}</span
                >
              }
            </span>
            {{ item.label }}
          </a>
        }
        <div class="flex-1"></div>
        <button
          type="button"
          class="size-11 rounded-full border-[1.5px] border-[#E2D3C6] bg-rosa text-base font-bold"
          aria-haspopup="dialog"
          [attr.aria-label]="'Menú de sesión de ' + name()"
          (click)="sessionOpen.set(true)"
        >
          {{ initial() }}
        </button>
      </nav>

      <div class="relative flex min-w-0 flex-1 flex-col">
        @if (!data().subpage) {
          <header
            class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[#EFE3D7] bg-[rgba(255,249,242,.96)] py-1.5 pl-4 pr-3 md:hidden"
          >
            <div class="flex items-center gap-2 text-accion">
              <nh-icon name="heart" /><span class="font-titulo text-xl font-medium text-ciruela"
                >Nuestra historia</span
              >
            </div>
            <button
              type="button"
              class="size-11 rounded-full border-[1.5px] border-[#E2D3C6] bg-rosa text-base font-bold"
              aria-haspopup="dialog"
              [attr.aria-label]="'Menú de sesión de ' + name()"
              (click)="sessionOpen.set(true)"
            >
              {{ initial() }}
            </button>
          </header>
        }
        @if (!network.online()) {
          <div
            role="status"
            class="flex shrink-0 items-center gap-2.5 bg-[#F7E9D6] px-4 py-2.5 text-sm font-medium leading-snug text-[#6A4A1E]"
          >
            <nh-icon name="wifi" />Se interrumpió la conexión. Lo que escribiste sigue aquí; vuelve
            a intentarlo cuando regrese.
          </div>
        }
        <main
          #content
          id="contenido"
          tabindex="-1"
          class="min-h-0 flex-1 outline-none"
          [class]="
            data().fill ? 'flex flex-col overflow-hidden' : 'overflow-y-auto overscroll-contain'
          "
        >
          <div
            class="flex min-h-full flex-col"
            [class.nh-legado]="data().legacy"
            [class.flex-1]="data().fill"
            [class.min-h-0]="data().fill"
          >
            <router-outlet />
          </div>
        </main>
        @if (!data().subpage && !keyboard.open()) {
          <nav
            aria-label="Secciones"
            class="grid shrink-0 grid-cols-4 border-t border-borde bg-papel px-1 pb-[calc(10px+env(safe-area-inset-bottom))] pt-1.5 md:hidden"
          >
            @for (item of navItems; track item.tab) {
              <a
                [routerLink]="item.link"
                [attr.aria-current]="data().tab === item.tab ? 'page' : null"
                [attr.aria-label]="navLabel(item)"
                class="relative flex min-h-[58px] flex-col items-center justify-center gap-[3px] text-[12.5px] no-underline"
                [class]="
                  data().tab === item.tab
                    ? 'font-bold text-ciruela'
                    : 'font-medium text-ciruela-medio'
                "
              >
                <span
                  class="relative flex h-[30px] w-14 items-center justify-center rounded-full"
                  [class.bg-rosa]="data().tab === item.tab"
                  ><nh-icon [name]="item.icon" />
                  @if (item.tab === 'inbox' && inbox.unread() > 0) {
                    <span
                      aria-hidden="true"
                      class="absolute -top-0.5 right-1.5 h-[18px] min-w-[18px] rounded-full border-2 border-papel bg-accion text-center text-[11px] font-bold leading-[14px] text-papel"
                      >{{ inbox.unread() }}</span
                    >
                  }
                </span>
                {{ item.label }}
              </a>
            }
          </nav>
        }
      </div>
    </div>

    <nh-panel
      [open]="sessionOpen()"
      labelledBy="panel-sesion-titulo"
      (closed)="sessionOpen.set(false)"
    >
      <div class="flex flex-col gap-3.5">
        <div class="flex items-center gap-3">
          <span
            aria-hidden="true"
            class="flex size-12 items-center justify-center rounded-full bg-rosa text-lg font-bold"
            >{{ initial() }}</span
          >
          <div>
            <h2 id="panel-sesion-titulo" class="m-0 font-titulo text-[22px] font-medium">
              {{ name() }}
            </h2>
            <p class="m-0 text-sm text-ciruela-suave">
              {{ auth.email() ?? 'Sesión iniciada' }}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="flex min-h-[52px] items-center gap-2.5 rounded-[14px] border-[1.5px] border-campo bg-papel px-4 text-base font-semibold text-accion"
          (click)="signOut()"
        >
          <nh-icon name="logout" />Cerrar sesión
        </button>
        <button type="button" class="nh-btn nh-btn-texto min-h-12" (click)="sessionOpen.set(false)">
          Cerrar
        </button>
      </div>
    </nh-panel>
  `,
})
export class AppShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly inbox = inject(InboxState);
  protected readonly network = inject(NetworkStatus);
  protected readonly keyboard = inject(KeyboardInset);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly layout = inject(LayoutState);
  private readonly content = viewChild.required<ElementRef<HTMLElement>>('content');

  protected readonly navItems = NAV_ITEMS;
  protected readonly sessionOpen = signal(false);
  protected readonly signingOut = signal(false);
  protected readonly name = computed(() => this.auth.profile()?.displayName ?? '');
  protected readonly initial = computed(() => initialOf(this.auth.profile()?.displayName));
  protected readonly data = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.leafData()),
    ),
    { initialValue: this.leafData() },
  );

  public constructor() {
    void this.inbox.refresh();
    effect(() => {
      const data = this.data();
      this.layout.bottomChrome.set(data.bottomBar ? 'bar' : data.subpage ? 'none' : 'nav');
    });
    const navigation = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.content().nativeElement.scrollTop = 0;
      });
    inject(DestroyRef).onDestroy(() => {
      navigation.unsubscribe();
      this.layout.bottomChrome.set('none');
    });
  }

  protected navLabel(item: NavItem): string {
    const unread = this.inbox.unread();
    return item.tab === 'inbox' && unread > 0 ? `${item.label}, ${unread} sin leer` : item.label;
  }

  protected focusContent(event: Event): void {
    event.preventDefault();
    this.content().nativeElement.focus();
  }

  protected async signOut(): Promise<void> {
    this.sessionOpen.set(false);
    this.signingOut.set(true);
    await this.auth.signOut();
  }

  private leafData(): ShellRouteData {
    let route = this.route.snapshot;
    while (route.firstChild !== null) route = route.firstChild;
    return { ...DEFAULT_DATA, ...(route.data as Partial<ShellRouteData>) };
  }
}
