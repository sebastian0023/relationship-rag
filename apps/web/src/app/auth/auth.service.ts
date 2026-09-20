import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { memberProfileSchema, type MemberProfile } from '@relationship-rag/contracts';
import { RUNTIME_CONFIG } from './runtime-config.js';

export type AuthenticationState =
  'checking' | 'anonymous' | 'authenticated' | 'denied' | 'unavailable';

const safeReturnTo = (value: unknown): string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/app';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly config = inject(RUNTIME_CONFIG);
  private readonly router = inject(Router);
  private readonly manager = this.config === null ? undefined : this.createManager();
  private refreshPromise: Promise<User | null> | undefined;

  public readonly state = signal<AuthenticationState>('checking');
  public readonly profile = signal<MemberProfile | null>(null);

  public async restore(): Promise<void> {
    if (this.manager === undefined) {
      this.state.set('unavailable');
      return;
    }
    const user = await this.manager.getUser();
    if (user === null || user.expired) {
      await this.manager.removeUser();
      this.state.set('anonymous');
      return;
    }
    await this.loadProfile(user);
  }

  public async startLogin(returnTo: string): Promise<void> {
    if (this.manager === undefined) {
      this.state.set('unavailable');
      return;
    }
    await this.manager.signinRedirect({ state: { returnTo: safeReturnTo(returnTo) } });
  }

  public async completeLogin(): Promise<void> {
    if (this.manager === undefined) {
      this.state.set('unavailable');
      return;
    }
    try {
      const user = await this.manager.signinRedirectCallback();
      window.history.replaceState({}, document.title, '/auth/callback');
      await this.loadProfile(user);
      if (this.state() === 'authenticated') {
        const state = user.state as { returnTo?: unknown } | undefined;
        await this.router.navigateByUrl(safeReturnTo(state?.returnTo));
      }
    } catch {
      await this.clearSession('anonymous');
    }
  }

  public async getAccessToken(): Promise<string | null> {
    if (this.manager === undefined) return null;
    const user = await this.manager.getUser();
    if (user !== null && !user.expired) return user.access_token;
    const refreshed = await this.refresh();
    return refreshed?.access_token ?? null;
  }

  public async signOut(): Promise<void> {
    if (this.manager === undefined) {
      await this.router.navigateByUrl('/');
      return;
    }
    await this.clearSession('anonymous');
    await this.manager.signoutRedirect({ post_logout_redirect_uri: `${window.location.origin}/` });
  }

  private createManager(): UserManager {
    const config = this.config;
    if (config === null) throw new Error('Runtime configuration is required.');
    return new UserManager({
      authority: config.authority,
      client_id: config.clientId,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: `${window.location.origin}/`,
      response_type: 'code',
      scope: config.scope,
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      automaticSilentRenew: false,
      revokeTokenTypes: ['refresh_token'],
    });
  }

  private async loadProfile(user: User): Promise<void> {
    const config = this.config;
    if (config === null) return;
    const response = await fetch(`${config.apiOrigin}/me`, {
      headers: { authorization: `Bearer ${user.access_token}` },
    });
    if (response.status === 403) {
      await this.clearSession('denied');
      return;
    }
    if (response.status === 401) {
      const refreshed = await this.refresh();
      if (refreshed !== null) return this.loadProfile(refreshed);
      await this.clearSession('anonymous');
      return;
    }
    if (!response.ok) {
      this.state.set('anonymous');
      return;
    }
    this.profile.set(memberProfileSchema.parse(await response.json()));
    this.state.set('authenticated');
  }

  private async refresh(): Promise<User | null> {
    if (this.manager === undefined) return null;
    this.refreshPromise ??= this.manager
      .signinSilent()
      .catch(() => null)
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }

  private async clearSession(state: AuthenticationState): Promise<void> {
    this.profile.set(null);
    await this.manager?.removeUser();
    this.state.set(state);
  }
}
