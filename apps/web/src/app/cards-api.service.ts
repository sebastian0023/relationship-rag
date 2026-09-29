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
import { ApiClient } from './api/api-client.service.js';

@Injectable({ providedIn: 'root' })
export class CardsApiService {
  private readonly api = inject(ApiClient);
  public async recipients() {
    return cardRecipientsSchema.parse(await this.api.request('/cards/recipients')).items;
  }
  public async generate(request: GenerateCardRequest) {
    return generatedCardDraftSchema.parse(
      await this.api.request('/cards/generate', { method: 'POST', body: JSON.stringify(request) }),
    );
  }
  public async create(request: SaveCardRequest) {
    return cardSchema.parse(
      await this.api.request('/cards', { method: 'POST', body: JSON.stringify(request) }),
    );
  }
  public async list(cursor?: string) {
    return cardListSchema.parse(
      await this.api.request(
        `/cards${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ),
    );
  }
  public async get(cardId: string) {
    return cardSchema.parse(await this.api.request(`/cards/${cardId}`));
  }
  public async update(cardId: string, request: UpdateCardRequest) {
    return cardSchema.parse(
      await this.api.request(`/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify(request),
      }),
    );
  }
  public async delete(cardId: string, version: number) {
    await this.api.request(`/cards/${cardId}?version=${version}`, { method: 'DELETE' });
  }
  public async send(cardId: string, request: SendCardRequest) {
    return sendCardResponseSchema.parse(
      await this.api.request(`/cards/${cardId}/send`, {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    );
  }
  public async inbox(cursor?: string) {
    return inboxListSchema.parse(
      await this.api.request(
        `/inbox${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ),
    );
  }
  public async inboxItem(cardId: string) {
    return inboxItemSchema.parse(await this.api.request(`/inbox/${cardId}`));
  }
  public async markRead(cardId: string) {
    return inboxItemSchema.parse(
      await this.api.request(`/inbox/${cardId}/read`, { method: 'PATCH' }),
    );
  }
}
