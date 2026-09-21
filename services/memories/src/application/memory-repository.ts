import type { Memory } from '../domain/memory.js';
import type { IngestionBatch, IngestionState, IngestionWork } from '../domain/ingestion.js';

export interface MemoryRepository {
  create(memory: Memory): Promise<void>;
  update(memory: Memory, expectedVersion: number): Promise<void>;
  findById(coupleId: string, memoryId: string): Promise<Memory | null>;
  listTimeline(
    coupleId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ readonly items: readonly Memory[]; readonly nextCursor?: string }>;
  delete(memory: Memory): Promise<void>;
  getIngestion(coupleId: string, memoryId: string): Promise<IngestionState | null>;
  requestIngestion(work: IngestionWork): Promise<IngestionState>;
  completeIngestion(
    coupleId: string,
    memoryId: string,
    generation: number,
    status: 'INDEXED' | 'FAILED',
    failureCode?: string,
  ): Promise<void>;
  listDueIngestionWork(
    coupleId: string,
    now: string,
    limit: number,
  ): Promise<readonly IngestionWork[]>;
  removeIngestionWork(coupleId: string, memoryId: string): Promise<void>;
  getIngestionBatch(coupleId: string): Promise<IngestionBatch | null>;
  saveIngestionBatch(coupleId: string, batch: IngestionBatch): Promise<void>;
  clearIngestionBatch(coupleId: string, jobId: string): Promise<void>;
}
