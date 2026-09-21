import type { IngestionStatus } from './memory.js';

export interface IngestionState {
  readonly coupleId: string;
  readonly memoryId: string;
  readonly status: IngestionStatus;
  readonly generation: number;
  readonly fingerprint?: string;
  readonly requestedAt?: string;
  readonly indexedAt?: string;
  readonly failureCode?: string;
  readonly attempts: number;
}

export interface IngestionWork {
  readonly coupleId: string;
  readonly memoryId: string;
  readonly generation: number;
  readonly fingerprint?: string;
  readonly operation: 'UPSERT' | 'DELETE';
  readonly attempts: number;
  readonly nextAttemptAt: string;
}

export interface IngestionBatch {
  readonly jobId: string;
  readonly startedAt: string;
  readonly items: readonly Pick<IngestionWork, 'memoryId' | 'generation'>[];
}
