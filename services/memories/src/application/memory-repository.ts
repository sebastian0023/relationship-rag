import type { Memory } from '../domain/memory.js';

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
}
