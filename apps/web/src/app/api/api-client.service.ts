import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service.js';
import { RUNTIME_CONFIG } from '../auth/runtime-config.js';
import { ApiError, NETWORK_FAILURE, apiErrorFrom } from './api-error.js';

/**
 * Authenticated JSON transport for every feature service. A 401 gets one silent refresh and then
 * leads to the session-expired screen; a 403 (inactive membership) leads to the access-denied
 * screen. Other failures surface as `ApiError` with only status, code, and correlation ID.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly auth = inject(AuthService);
  private readonly config = inject(RUNTIME_CONFIG);
  private readonly router = inject(Router);

  public async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.send(path, init, false);
    return response.status === 204 ? {} : response.json();
  }

  /** Uploads to a presigned POST, reporting progress from 0 to 1. */
  public upload(
    url: string,
    fields: Readonly<Record<string, string>>,
    file: File,
    onProgress: (fraction: number) => void,
  ): Promise<void> {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    form.append('file', file);
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', url);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
      request.onload = () =>
        request.status >= 200 && request.status < 300
          ? resolve()
          : reject(new ApiError(request.status, 'UPLOAD_FAILED'));
      request.onerror = () => reject(new ApiError(0, NETWORK_FAILURE));
      request.send(form);
    });
  }

  private async send(path: string, init: RequestInit, retried: boolean): Promise<Response> {
    if (this.config === null) throw new ApiError(0, 'NOT_CONFIGURED');
    const token = retried ? await this.auth.refreshAccessToken() : await this.auth.getAccessToken();
    if (token === null) {
      await this.auth.handleSessionExpired(this.router.url);
      throw new ApiError(401, 'UNAUTHENTICATED');
    }
    let response: Response;
    try {
      response = await fetch(`${this.config.apiOrigin}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
      });
    } catch {
      throw new ApiError(0, NETWORK_FAILURE);
    }
    if (response.ok) return response;
    if (response.status === 401 && !retried) return this.send(path, init, true);
    const body: unknown = await response.json().catch(() => undefined);
    const error = apiErrorFrom(response.status, body, response.headers.get('x-correlation-id'));
    if (response.status === 401) await this.auth.handleSessionExpired(this.router.url);
    if (response.status === 403) await this.auth.handleAccessDenied();
    throw error;
  }
}
