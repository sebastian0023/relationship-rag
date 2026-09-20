import { randomUUID } from 'node:crypto';
import type { CreateMemoryRequest, UpdateMemoryRequest } from '@relationship-rag/contracts';
import { ConflictError, ResourceNotFoundError } from '@relationship-rag/domain';
import type { Memory, MemoryPhoto } from '../domain/memory.js';
import type { MemoryRepository } from './memory-repository.js';

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
    return memory;
  }

  public async get(coupleId: string, memoryId: string): Promise<Memory> {
    const memory = await this.memories.findById(coupleId, memoryId);
    if (memory === null) throw new ResourceNotFoundError();
    return memory;
  }

  public list(coupleId: string, cursor?: string, limit?: number) {
    return this.memories.listTimeline(coupleId, cursor, limit);
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
    return memory;
  }

  public async delete(coupleId: string, memoryId: string): Promise<void> {
    await this.memories.delete(await this.get(coupleId, memoryId));
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
}
