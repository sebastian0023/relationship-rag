import type { Logger, Metrics } from '@relationship-rag/observability';
import type { MemoryRepository } from './memory-repository.js';
import { normalizeMemoryDocument } from './memory-document.js';
import type { IngestionBatch, IngestionWork } from '../domain/ingestion.js';

export interface SourceDocumentStore {
  put(document: ReturnType<typeof normalizeMemoryDocument>): Promise<void>;
  delete(coupleId: string, memoryId: string): Promise<void>;
}

export type RemoteJobStatus = 'STARTING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED' | 'STOPPED';
export interface KnowledgeBaseIngestion {
  start(idempotencyToken: string): Promise<string>;
  status(jobId: string): Promise<RemoteJobStatus>;
  stop(jobId: string): Promise<void>;
}

export class IngestionCoordinator {
  public constructor(
    private readonly coupleId: string,
    private readonly repository: MemoryRepository,
    private readonly source: SourceDocumentStore,
    private readonly knowledgeBase: KnowledgeBaseIngestion,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
    private readonly metrics?: Metrics,
  ) {}

  public async run(): Promise<void> {
    const current = await this.repository.getIngestionBatch(this.coupleId);
    if (current !== null) return this.reconcile(current);
    const work = await this.repository.listDueIngestionWork(
      this.coupleId,
      this.clock().toISOString(),
      25,
    );
    if (work.length === 0) return;
    const accepted: IngestionWork[] = [];
    for (const item of work) {
      try {
        if (item.operation === 'DELETE') await this.source.delete(item.coupleId, item.memoryId);
        else {
          const memory = await this.repository.findById(item.coupleId, item.memoryId);
          if (memory === null) {
            await this.repository.completeIngestion(
              item.coupleId,
              item.memoryId,
              item.generation,
              'FAILED',
              'MISSING_MEMORY',
            );
            continue;
          }
          const document = normalizeMemoryDocument(memory);
          if (item.fingerprint !== undefined && document.fingerprint !== item.fingerprint) continue;
          await this.source.put(document);
        }
        accepted.push(item);
      } catch {
        this.metrics?.put('RecordFailure', 1);
        await this.repository.completeIngestion(
          item.coupleId,
          item.memoryId,
          item.generation,
          'FAILED',
          'SOURCE_WRITE_FAILED',
        );
      }
    }
    if (accepted.length === 0) return;
    try {
      const jobId = await this.knowledgeBase.start(
        accepted
          .map((item) => `${item.memoryId}:${item.generation}`)
          .join('|')
          .slice(0, 64),
      );
      await this.repository.saveIngestionBatch(this.coupleId, {
        jobId,
        startedAt: this.clock().toISOString(),
        items: accepted.map(({ memoryId, generation }) => ({ memoryId, generation })),
      });
      this.logger.log('info', 'ingestion.batch.started', { itemCount: accepted.length });
    } catch {
      this.metrics?.put('RecordFailure', accepted.length);
      for (const item of accepted)
        await this.repository.completeIngestion(
          item.coupleId,
          item.memoryId,
          item.generation,
          'FAILED',
          'INGESTION_START_FAILED',
        );
    }
  }

  private async reconcile(batch: IngestionBatch): Promise<void> {
    const elapsedMs = this.clock().getTime() - Date.parse(batch.startedAt);
    if (elapsedMs > 30 * 60 * 1000) {
      await this.knowledgeBase.stop(batch.jobId).catch(() => undefined);
      await this.finish(batch, 'FAILED', 'INGESTION_STALLED');
      return;
    }
    const status = await this.knowledgeBase.status(batch.jobId);
    if (status === 'STARTING' || status === 'IN_PROGRESS') return;
    await this.finish(
      batch,
      status === 'COMPLETE' ? 'INDEXED' : 'FAILED',
      status === 'COMPLETE' ? undefined : 'INGESTION_FAILED',
    );
  }

  private async finish(
    batch: IngestionBatch,
    status: 'INDEXED' | 'FAILED',
    failureCode?: string,
  ): Promise<void> {
    for (const item of batch.items) {
      try {
        await this.repository.completeIngestion(
          this.coupleId,
          item.memoryId,
          item.generation,
          status,
          failureCode,
        );
      } catch {
        // A newer edit owns the state; it remains queued for the next job.
      }
    }
    await this.repository.clearIngestionBatch(this.coupleId, batch.jobId);
    this.logger.log(status === 'INDEXED' ? 'info' : 'warn', 'ingestion.batch.completed', {
      itemCount: batch.items.length,
      status,
    });
    if (status !== 'INDEXED') this.metrics?.put('RecordFailure', batch.items.length);
  }
}
