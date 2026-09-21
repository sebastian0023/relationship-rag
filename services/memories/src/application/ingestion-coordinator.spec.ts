import { describe, expect, it } from 'vitest';
import type { Logger } from '@relationship-rag/observability';
import {
  IngestionCoordinator,
  type KnowledgeBaseIngestion,
  type SourceDocumentStore,
} from './ingestion-coordinator.js';
import type { MemoryRepository } from './memory-repository.js';
import type { IngestionBatch, IngestionState, IngestionWork } from '../domain/ingestion.js';
import type { Memory } from '../domain/memory.js';

const memory: Memory = {
  memoryId: 'c8e9bd6c-29cc-4c84-8799-6210fb7d8520',
  coupleId: 'couple-a',
  createdBy: 'member-a',
  title: 'Trip',
  occurredOn: '2025-01-01',
  body: 'We went to Oaxaca.',
  locale: 'en',
  tags: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  version: 1,
  photos: [],
  ingestionStatus: 'PENDING',
};
class FakeRepository implements MemoryRepository {
  public batch: IngestionBatch | null = null;
  public completed: Array<{ status: string; generation: number }> = [];
  public result: Memory | null = memory;
  public rejectCompletion = false;
  public constructor(public work: IngestionWork[]) {}
  public async create(): Promise<void> {}
  public async update(): Promise<void> {}
  public async findById(): Promise<Memory | null> {
    return this.result;
  }
  public async listTimeline(): Promise<{ items: readonly Memory[] }> {
    return { items: [] };
  }
  public async delete(): Promise<void> {}
  public async getIngestion(): Promise<IngestionState | null> {
    return null;
  }
  public async requestIngestion(): Promise<IngestionState> {
    throw new Error('not used');
  }
  public async completeIngestion(
    _couple: string,
    _memory: string,
    generation: number,
    status: 'INDEXED' | 'FAILED',
  ): Promise<void> {
    if (this.rejectCompletion) throw new Error('newer generation');
    this.completed.push({ generation, status });
  }
  public async listDueIngestionWork(): Promise<readonly IngestionWork[]> {
    return this.work;
  }
  public async removeIngestionWork(): Promise<void> {}
  public async getIngestionBatch(): Promise<IngestionBatch | null> {
    return this.batch;
  }
  public async saveIngestionBatch(_couple: string, batch: IngestionBatch): Promise<void> {
    this.batch = batch;
  }
  public async clearIngestionBatch(): Promise<void> {
    this.batch = null;
  }
}
const logger: Logger = { log() {} };
describe('IngestionCoordinator', () => {
  it('writes a source document, persists a batch, then marks its generation indexed', async () => {
    const repository = new FakeRepository([
      {
        coupleId: 'couple-a',
        memoryId: memory.memoryId,
        generation: 1,
        fingerprint: undefined,
        operation: 'UPSERT',
        attempts: 0,
        nextAttemptAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
    let puts = 0;
    const source: SourceDocumentStore = {
      async put() {
        puts += 1;
      },
      async delete() {},
    };
    let status: 'IN_PROGRESS' | 'COMPLETE' = 'IN_PROGRESS';
    const knowledgeBase: KnowledgeBaseIngestion = {
      async start() {
        return 'job-1';
      },
      async status() {
        return status;
      },
      async stop() {},
    };
    const coordinator = new IngestionCoordinator(
      'couple-a',
      repository,
      source,
      knowledgeBase,
      logger,
      () => new Date('2025-01-01T00:00:00.000Z'),
    );
    await coordinator.run();
    expect(puts).toBe(1);
    expect(repository.batch?.jobId).toBe('job-1');
    status = 'COMPLETE';
    await coordinator.run();
    expect(repository.completed).toEqual([{ generation: 1, status: 'INDEXED' }]);
    expect(repository.batch).toBeNull();
  });

  it('marks missing or source-write failures failed without starting an empty batch', async () => {
    const repository = new FakeRepository([
      {
        coupleId: 'couple-a',
        memoryId: memory.memoryId,
        generation: 1,
        operation: 'DELETE',
        attempts: 0,
        nextAttemptAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
    const source: SourceDocumentStore = {
      async put() {},
      async delete() {
        throw new Error('S3 unavailable');
      },
    };
    const knowledgeBase: KnowledgeBaseIngestion = {
      async start() {
        throw new Error('must not start');
      },
      async status() {
        return 'COMPLETE';
      },
      async stop() {},
    };
    await new IngestionCoordinator('couple-a', repository, source, knowledgeBase, logger).run();
    expect(repository.completed).toEqual([{ generation: 1, status: 'FAILED' }]);
    expect(repository.batch).toBeNull();
  });

  it('marks source materialization batches failed when Bedrock cannot start', async () => {
    const repository = new FakeRepository([
      {
        coupleId: 'couple-a',
        memoryId: memory.memoryId,
        generation: 1,
        operation: 'UPSERT',
        attempts: 0,
        nextAttemptAt: '2025-01-01T00:00:00.000Z',
      },
    ]);
    const source: SourceDocumentStore = { async put() {}, async delete() {} };
    const knowledgeBase: KnowledgeBaseIngestion = {
      async start() {
        throw new Error('throttled');
      },
      async status() {
        return 'COMPLETE';
      },
      async stop() {},
    };
    await new IngestionCoordinator('couple-a', repository, source, knowledgeBase, logger).run();
    expect(repository.completed).toEqual([{ generation: 1, status: 'FAILED' }]);
  });

  it('fails a stalled batch even when stop fails and ignores a stale completion', async () => {
    const repository = new FakeRepository([]);
    repository.batch = {
      jobId: 'job-1',
      startedAt: '2025-01-01T00:00:00.000Z',
      items: [{ memoryId: memory.memoryId, generation: 1 }],
    };
    repository.rejectCompletion = true;
    const knowledgeBase: KnowledgeBaseIngestion = {
      async start() {
        return 'unused';
      },
      async status() {
        return 'FAILED';
      },
      async stop() {
        throw new Error('already stopped');
      },
    };
    await new IngestionCoordinator(
      'couple-a',
      repository,
      { async put() {}, async delete() {} },
      knowledgeBase,
      logger,
      () => new Date('2025-01-01T00:31:00.000Z'),
    ).run();
    expect(repository.batch).toBeNull();
    expect(repository.completed).toEqual([]);
  });
});
