import type { Memory } from '../domain/memory.js';

export interface MemoryRepository {
  save(memory: Memory): Promise<void>;
  findById(coupleId: string, memoryId: string): Promise<Memory | null>;
  listTimeline(coupleId: string): Promise<readonly Memory[]>;
}
