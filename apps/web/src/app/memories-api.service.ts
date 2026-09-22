import { Injectable, inject } from '@angular/core';
import {
  memorySchema,
  ingestionStatusSchema,
  timelineResponseSchema,
  type CreateMemoryRequest,
  type CreateUploadRequest,
  type MemoryDto,
  type IngestionStatusResponse,
  type UpdateMemoryRequest,
} from '@relationship-rag/contracts';
import { AuthService } from './auth/auth.service.js';
import { RUNTIME_CONFIG } from './auth/runtime-config.js';

@Injectable({ providedIn: 'root' })
export class MemoriesApiService {
  private readonly auth = inject(AuthService);
  private readonly config = inject(RUNTIME_CONFIG);
  public async timeline(cursor?: string): Promise<ReturnType<typeof timelineResponseSchema.parse>> {
    return timelineResponseSchema.parse(
      await this.request(
        `/timeline${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ),
    );
  }
  public async get(memoryId: string): Promise<MemoryDto> {
    return memorySchema.parse(await this.request(`/memories/${memoryId}`));
  }
  public async create(request: CreateMemoryRequest): Promise<MemoryDto> {
    return memorySchema.parse(
      await this.request('/memories', { method: 'POST', body: JSON.stringify(request) }),
    );
  }
  public async update(memoryId: string, request: UpdateMemoryRequest): Promise<MemoryDto> {
    return memorySchema.parse(
      await this.request(`/memories/${memoryId}`, {
        method: 'PATCH',
        body: JSON.stringify(request),
      }),
    );
  }
  public async delete(memoryId: string): Promise<void> {
    await this.request(`/memories/${memoryId}`, { method: 'DELETE' });
  }
  public async deletePhoto(memoryId: string, photoId: string): Promise<void> {
    await this.request(`/memories/${memoryId}/photos/${photoId}`, { method: 'DELETE' });
  }
  public async ingestion(memoryId: string): Promise<IngestionStatusResponse> {
    return ingestionStatusSchema.parse(await this.request(`/memories/${memoryId}/ingestion`));
  }
  public async reindex(memoryId: string): Promise<IngestionStatusResponse> {
    return ingestionStatusSchema.parse(
      await this.request(`/memories/${memoryId}/reindex`, { method: 'POST' }),
    );
  }
  public async upload(memoryId: string, file: File): Promise<void> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Choose a JPEG, PNG, or WebP photo.');
    }
    const upload = (await this.request(`/memories/${memoryId}/uploads`, {
      method: 'POST',
      body: JSON.stringify({
        contentType: file.type as CreateUploadRequest['contentType'],
        sizeBytes: file.size,
      } satisfies CreateUploadRequest),
    })) as { url: string; fields: Record<string, string> };
    const form = new FormData();
    Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
    form.append('file', file);
    const response = await fetch(upload.url, { method: 'POST', body: form });
    if (!response.ok) throw new Error('Photo upload failed.');
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
      const error = (await response.json().catch(() => ({}))) as {
        message?: string;
        correlationId?: string;
      };
      const correlationId = error.correlationId ?? response.headers.get('x-correlation-id');
      throw new Error(
        `${error.message ?? 'Unable to complete this request.'}${correlationId === null || correlationId === undefined ? '' : ` Reference: ${correlationId}`}`,
      );
    }
    return response.status === 204 ? {} : response.json();
  }
}
