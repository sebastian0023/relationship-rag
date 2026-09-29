import { Injectable, inject } from '@angular/core';
import {
  memorySchema,
  ingestionStatusSchema,
  timelineResponseSchema,
  uploadInstructionsSchema,
  type CreateMemoryRequest,
  type CreateUploadRequest,
  type MemoryDto,
  type IngestionStatusResponse,
  type TimelineResponse,
  type UpdateMemoryRequest,
  type UploadInstructions,
} from '@relationship-rag/contracts';
import { ApiClient } from './api/api-client.service.js';

@Injectable({ providedIn: 'root' })
export class MemoriesApiService {
  private readonly api = inject(ApiClient);
  public async timeline(cursor?: string): Promise<TimelineResponse> {
    return timelineResponseSchema.parse(
      await this.api.request(
        `/timeline${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
      ),
    );
  }
  public async get(memoryId: string): Promise<MemoryDto> {
    return memorySchema.parse(await this.api.request(`/memories/${memoryId}`));
  }
  public async create(request: CreateMemoryRequest): Promise<MemoryDto> {
    return memorySchema.parse(
      await this.api.request('/memories', { method: 'POST', body: JSON.stringify(request) }),
    );
  }
  public async update(memoryId: string, request: UpdateMemoryRequest): Promise<MemoryDto> {
    return memorySchema.parse(
      await this.api.request(`/memories/${memoryId}`, {
        method: 'PATCH',
        body: JSON.stringify(request),
      }),
    );
  }
  public async delete(memoryId: string): Promise<void> {
    await this.api.request(`/memories/${memoryId}`, { method: 'DELETE' });
  }
  public async deletePhoto(memoryId: string, photoId: string): Promise<void> {
    await this.api.request(`/memories/${memoryId}/photos/${photoId}`, { method: 'DELETE' });
  }
  public async ingestion(memoryId: string): Promise<IngestionStatusResponse> {
    return ingestionStatusSchema.parse(await this.api.request(`/memories/${memoryId}/ingestion`));
  }
  public async reindex(memoryId: string): Promise<IngestionStatusResponse> {
    return ingestionStatusSchema.parse(
      await this.api.request(`/memories/${memoryId}/reindex`, { method: 'POST' }),
    );
  }
  /** Reserves a photo slot and returns the presigned upload for it. */
  public async createUpload(memoryId: string, file: File): Promise<UploadInstructions> {
    return uploadInstructionsSchema.parse(
      await this.api.request(`/memories/${memoryId}/uploads`, {
        method: 'POST',
        body: JSON.stringify({
          contentType: file.type as CreateUploadRequest['contentType'],
          sizeBytes: file.size,
        } satisfies CreateUploadRequest),
      }),
    );
  }
  public uploadFile(
    instructions: UploadInstructions,
    file: File,
    onProgress: (fraction: number) => void,
  ): Promise<void> {
    return this.api.upload(instructions.url, instructions.fields, file, onProgress);
  }
}
