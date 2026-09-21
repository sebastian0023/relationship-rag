import { describe, expect, it } from 'vitest';
import { ConflictError, ResourceNotFoundError } from '@relationship-rag/domain';
import { MemoryService } from './memory-service.js';
import type { MemoryRepository } from './memory-repository.js';
import type { Memory } from '../domain/memory.js';
import type { IngestionBatch, IngestionState, IngestionWork } from '../domain/ingestion.js';

class FakeRepository implements MemoryRepository {
  public readonly values = new Map<string, Memory>();
  public readonly ingestion = new Map<string, IngestionState>();
  public readonly work = new Map<string, IngestionWork>();
  public async create(memory: Memory): Promise<void> {
    this.values.set(memory.memoryId, memory);
  }
  public async update(memory: Memory, expected: number): Promise<void> {
    const old = this.values.get(memory.memoryId);
    if (old?.version !== expected) throw new ConflictError();
    this.values.set(memory.memoryId, memory);
  }
  public async findById(_coupleId: string, id: string): Promise<Memory | null> {
    return this.values.get(id) ?? null;
  }
  public async listTimeline(): Promise<{ items: readonly Memory[] }> {
    return {
      items: [...this.values.values()].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    };
  }
  public async delete(memory: Memory): Promise<void> {
    this.values.delete(memory.memoryId);
  }
  public async getIngestion(_coupleId: string, memoryId: string): Promise<IngestionState | null> {
    return this.ingestion.get(memoryId) ?? null;
  }
  public async requestIngestion(work: IngestionWork): Promise<IngestionState> {
    const current = this.ingestion.get(work.memoryId);
    if (
      current?.status === 'PENDING' &&
      current.fingerprint === work.fingerprint &&
      current.generation >= work.generation
    )
      return current;
    const state: IngestionState = {
      coupleId: work.coupleId,
      memoryId: work.memoryId,
      status: 'PENDING',
      generation: work.generation,
      ...(work.fingerprint === undefined ? {} : { fingerprint: work.fingerprint }),
      requestedAt: new Date().toISOString(),
      attempts: work.attempts,
    };
    this.ingestion.set(work.memoryId, state);
    this.work.set(work.memoryId, work);
    return state;
  }
  public async completeIngestion(
    _coupleId: string,
    memoryId: string,
    generation: number,
    status: 'INDEXED' | 'FAILED',
    failureCode?: string,
  ): Promise<void> {
    const state = this.ingestion.get(memoryId);
    if (state === undefined || state.generation !== generation) throw new ConflictError();
    this.ingestion.set(memoryId, {
      ...state,
      status,
      ...(failureCode === undefined ? {} : { failureCode }),
      indexedAt: new Date().toISOString(),
    });
    this.work.delete(memoryId);
  }
  public async listDueIngestionWork(): Promise<readonly IngestionWork[]> {
    return [...this.work.values()];
  }
  public async removeIngestionWork(_coupleId: string, memoryId: string): Promise<void> {
    this.work.delete(memoryId);
  }
  public async getIngestionBatch(): Promise<IngestionBatch | null> {
    return null;
  }
  public async saveIngestionBatch(): Promise<void> {}
  public async clearIngestionBatch(): Promise<void> {}
}
const request = {
  title: 'First trip',
  occurredOn: '2025-05-14',
  body: 'A beautiful day.',
  locale: 'en' as const,
  tags: ['travel'],
};
describe('MemoryService', () => {
  it('creates a shared text memory with a first version', async () => {
    const service = new MemoryService(new FakeRepository());
    const memory = await service.create('couple-1', 'owner-1', request);
    expect(memory).toMatchObject({
      coupleId: 'couple-1',
      createdBy: 'owner-1',
      version: 1,
      ingestionStatus: 'PENDING',
      photos: [],
    });
  });
  it('queues a new generation when content changes but not when photos change', async () => {
    const repository = new FakeRepository();
    const service = new MemoryService(repository);
    const memory = await service.create('couple-1', 'owner-1', request);
    const updated = await service.update('couple-1', memory.memoryId, {
      ...request,
      body: 'Changed.',
      version: memory.version,
    });
    expect(repository.ingestion.get(memory.memoryId)?.generation).toBe(2);
    await service.reservePhoto('couple-1', memory.memoryId, 'image/jpeg');
    expect(repository.ingestion.get(memory.memoryId)?.generation).toBe(2);
    expect(updated.ingestionStatus).toBe('PENDING');
  });
  it('rejects a stale update', async () => {
    const repository = new FakeRepository();
    const service = new MemoryService(repository);
    const memory = await service.create('couple-1', 'owner-1', request);
    await service.update('couple-1', memory.memoryId, { ...request, title: 'Changed', version: 1 });
    await expect(
      service.update('couple-1', memory.memoryId, { ...request, version: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it('limits each memory to ten reserved photo slots', async () => {
    const service = new MemoryService(new FakeRepository());
    const memory = await service.create('couple-1', 'owner-1', request);
    for (let index = 0; index < 10; index += 1)
      await service.reservePhoto('couple-1', memory.memoryId, 'image/jpeg');
    await expect(
      service.reservePhoto('couple-1', memory.memoryId, 'image/jpeg'),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it('lists, updates, removes photos, and deletes a memory', async () => {
    const repository = new FakeRepository();
    const service = new MemoryService(repository);
    const memory = await service.create('couple-1', 'owner-1', { ...request, location: 'Beach' });
    expect((await service.list('couple-1')).items).toHaveLength(1);
    const updated = await service.update('couple-1', memory.memoryId, { ...request, version: 1 });
    expect(updated.location).toBeUndefined();
    const photo = await service.reservePhoto('couple-1', memory.memoryId, 'image/webp');
    await expect(
      service.removePhoto('couple-1', memory.memoryId, photo.photo.photoId),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await service.delete('couple-1', memory.memoryId);
    await expect(service.get('couple-1', memory.memoryId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
  it('does not remove a nonexistent photo', async () => {
    const service = new MemoryService(new FakeRepository());
    const memory = await service.create('couple-1', 'owner-1', request);
    await expect(
      service.removePhoto('couple-1', memory.memoryId, 'missing'),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
