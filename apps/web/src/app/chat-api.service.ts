import { Injectable, inject } from '@angular/core';
import {
  chatTurnSchema,
  conversationListSchema,
  conversationSchema,
  conversationSummarySchema,
  type CreateMessageRequest,
} from '@relationship-rag/contracts';
import { AuthService } from './auth/auth.service.js';
import { RUNTIME_CONFIG } from './auth/runtime-config.js';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly auth = inject(AuthService);
  private readonly config = inject(RUNTIME_CONFIG);
  public async createConversation() {
    return conversationSummarySchema.parse(
      await this.request('/conversations', { method: 'POST' }),
    );
  }
  public async list() {
    return conversationListSchema.parse(await this.request('/conversations'));
  }
  public async get(conversationId: string) {
    return conversationSchema.parse(await this.request(`/conversations/${conversationId}`));
  }
  public async send(conversationId: string, message: CreateMessageRequest) {
    return chatTurnSchema.parse(
      await this.request(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify(message),
      }),
    );
  }
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (this.config === null) throw new Error('The API is not configured.');
    const token = await this.auth.getAccessToken();
    if (token === null) throw new Error('Your session has expired.');
    const response = await fetch(`${this.config.apiOrigin}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(error.message ?? 'Unable to complete this request.');
    }
    return response.json();
  }
}
