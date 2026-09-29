import { Injectable, inject } from '@angular/core';
import {
  chatTurnSchema,
  conversationListSchema,
  conversationSchema,
  conversationSummarySchema,
  type CreateMessageRequest,
} from '@relationship-rag/contracts';
import { ApiClient } from './api/api-client.service.js';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly api = inject(ApiClient);
  public async createConversation() {
    return conversationSummarySchema.parse(
      await this.api.request('/conversations', { method: 'POST' }),
    );
  }
  public async list() {
    return conversationListSchema.parse(await this.api.request('/conversations'));
  }
  public async get(conversationId: string) {
    return conversationSchema.parse(await this.api.request(`/conversations/${conversationId}`));
  }
  public async send(conversationId: string, message: CreateMessageRequest) {
    return chatTurnSchema.parse(
      await this.api.request(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify(message),
      }),
    );
  }
}
