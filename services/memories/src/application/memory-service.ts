import { randomUUID } from 'node:crypto';
import type { CreateMemoryRequest, UpdateMemoryRequest } from '@relationship-rag/contracts';
import { ConflictError, ResourceNotFoundError } from '@relationship-rag/domain';
import type { Memory, MemoryPhoto } from '../domain/memory.js';
import type { IngestionState } from '../domain/ingestion.js';
import type { MemoryRepository } from './memory-repository.js';
import { normalizeMemoryDocument } from './memory-document.js';

const now = (): string => new Date().toISOString();

export class MemoryService {
  public constructor(private readonly memories: MemoryRepository) {}

  public async create(
    coupleId: string,
    userId: string,
    request: CreateMemoryRequest,
  ): Promise<Memory> {
    const timestamp = now();
    const memory: Memory = {
      memoryId: randomUUID(),
      coupleId,
      createdBy: userId,
      title: request.title,
      occurredOn: request.occurredOn,
      body: request.body,
      locale: request.locale,
      tags: request.tags,
      ...(request.location === undefined ? {} : { location: request.location }),
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      photos: [],
      ingestionStatus: 'NOT_REQUESTED',
    };
    await this.memories.create(memory);
    return this.enqueue(memory, 'UPSERT');
  }

  public async get(coupleId: string, memoryId: string): Promise<Memory> {
    const memory = await this.memories.findById(coupleId, memoryId);
    if (memory === null) throw new ResourceNotFoundError();
    return this.withIngestion(memory);
  }

  public async list(coupleId: string, cursor?: string, limit?: number) {
    const timeline = await this.memories.listTimeline(coupleId, cursor, limit);
    return {
      ...timeline,
      items: await Promise.all(timeline.items.map((memory) => this.withIngestion(memory))),
    };
  }

  public async update(
    coupleId: string,
    memoryId: string,
    request: UpdateMemoryRequest,
  ): Promise<Memory> {
    const current = await this.get(coupleId, memoryId);
    if (current.version !== request.version) throw new ConflictError();
    const withoutLocation =
      request.location === undefined
        ? (() => {
            const { location: ignored, ...rest } = current;
            void ignored;
            return rest;
          })()
        : current;
    const memory: Memory = {
      ...withoutLocation,
      title: request.title,
      occurredOn: request.occurredOn,
      body: request.body,
      locale: request.locale,
      tags: request.tags,
      updatedAt: now(),
      version: current.version + 1,
      ...(request.location === undefined ? {} : { location: request.location }),
    };
    await this.memories.update(memory, request.version);
    return this.enqueue(memory, 'UPSERT');
  }

  public async delete(coupleId: string, memoryId: string): Promise<void> {
    const memory = await this.get(coupleId, memoryId);
    await this.enqueue(memory, 'DELETE');
    await this.memories.delete(memory);
  }

  public async reservePhoto(
    coupleId: string,
    memoryId: string,
    contentType: MemoryPhoto['contentType'],
  ): Promise<{ memory: Memory; photo: MemoryPhoto }> {
    const current = await this.get(coupleId, memoryId);
    if (current.photos.length >= 10) throw new ConflictError();
    const photo: MemoryPhoto = {
      photoId: randomUUID(),
      contentType,
      status: 'PENDING',
      stagingKey: `staging/${coupleId}/${memoryId}/${randomUUID()}`,
    };
    const memory: Memory = {
      ...current,
      photos: [...current.photos, photo],
      version: current.version + 1,
      updatedAt: now(),
    };
    await this.memories.update(memory, current.version);
    return { memory, photo };
  }

  public async removePhoto(
    coupleId: string,
    memoryId: string,
    photoId: string,
  ): Promise<MemoryPhoto> {
    const current = await this.get(coupleId, memoryId);
    const photo = current.photos.find((item) => item.photoId === photoId);
    if (photo === undefined) throw new ResourceNotFoundError();
    await this.memories.update(
      {
        ...current,
        photos: current.photos.filter((item) => item.photoId !== photoId),
        version: current.version + 1,
        updatedAt: now(),
      },
      current.version,
    );
    return photo;
  }

  public async ingestion(coupleId: string, memoryId: string): Promise<IngestionState> {
    await this.get(coupleId, memoryId);
    return (
      (await this.memories.getIngestion(coupleId, memoryId)) ?? {
        coupleId,
        memoryId,
        status: 'NOT_REQUESTED',
        generation: 0,
        attempts: 0,
      }
    );
  }

  public async reindex(coupleId: string, memoryId: string): Promise<Memory> {
    return this.enqueue(await this.get(coupleId, memoryId), 'UPSERT');
  }

  private async enqueue(memory: Memory, operation: 'UPSERT' | 'DELETE'): Promise<Memory> {
    const current = await this.memories.getIngestion(memory.coupleId, memory.memoryId);
    const fingerprint =
      operation === 'UPSERT' ? normalizeMemoryDocument(memory).fingerprint : undefined;
    const state = await this.memories.requestIngestion({
      coupleId: memory.coupleId,
      memoryId: memory.memoryId,
      generation:
        current?.status === 'PENDING' && current.fingerprint === fingerprint
          ? current.generation
          : (current?.generation ?? 0) + 1,
      ...(fingerprint === undefined ? {} : { fingerprint }),
      operation,
      attempts: 0,
      nextAttemptAt: now(),
    });
    return { ...memory, ingestionStatus: state.status };
  }

  private async withIngestion(memory: Memory): Promise<Memory> {
    const state = await this.memories.getIngestion(memory.coupleId, memory.memoryId);
    return { ...memory, ingestionStatus: state?.status ?? 'NOT_REQUESTED' };
  }
}
