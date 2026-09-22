import { Injectable, inject } from '@angular/core';
import {
  cardListSchema,
  cardRecipientsSchema,
  cardSchema,
  generatedCardDraftSchema,
  inboxItemSchema,
  inboxListSchema,
  sendCardResponseSchema,
  type GenerateCardRequest,
  type SaveCardRequest,
  type SendCardRequest,
  type UpdateCardRequest,
} from '@relationship-rag/contracts';
import { AuthService } from './auth/auth.service.js';
import { RUNTIME_CONFIG } from './auth/runtime-config.js';

@Injectable({ providedIn: 'root' })
export class CardsApiService {
  private readonly auth = inject(AuthService);
  private readonly config = inject(RUNTIME_CONFIG);
  public async recipients() {
    return cardRecipientsSchema.parse(await this.request('/cards/recipients')).items;
  }
  public async generate(request: GenerateCardRequest) {
    return generatedCardDraftSchema.parse(
      await this.request('/cards/generate', { method: 'POST', body: JSON.stringify(request) }),
    );
  }
  public async create(request: SaveCardRequest) {
    return cardSchema.parse(
      await this.request('/cards', { method: 'POST', body: JSON.stringify(request) }),
    );
  }
  public async list(cursor?: string) {
    return cardListSchema.parse(
      await this.request(
        `/cards${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ),
    );
  }
  public async get(cardId: string) {
    return cardSchema.parse(await this.request(`/cards/${cardId}`));
  }
  public async update(cardId: string, request: UpdateCardRequest) {
    return cardSchema.parse(
      await this.request(`/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(request) }),
    );
  }
  public async delete(cardId: string, version: number) {
    await this.request(`/cards/${cardId}?version=${version}`, { method: 'DELETE' });
  }
  public async send(cardId: string, request: SendCardRequest) {
    return sendCardResponseSchema.parse(
      await this.request(`/cards/${cardId}/send`, {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
  }
  public async inbox(cursor?: string) {
    return inboxListSchema.parse(
      await this.request(
        `/inbox${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ),
    );
  }
  public async inboxItem(cardId: string) {
    return inboxItemSchema.parse(await this.request(`/inbox/${cardId}`));
  }
  public async markRead(cardId: string) {
    return inboxItemSchema.parse(await this.request(`/inbox/${cardId}/read`, { method: 'PATCH' }));
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
    return response.status === 204 ? {} : response.json();
  }
}
