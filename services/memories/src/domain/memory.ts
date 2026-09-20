export type IngestionStatus = 'NOT_REQUESTED' | 'PENDING' | 'INDEXED' | 'FAILED';

export interface Memory {
  readonly memoryId: string;
  readonly coupleId: string;
  readonly createdBy: string;
  readonly title: string;
  readonly occurredOn: string;
  readonly body: string;
  readonly locale: 'en' | 'es';
  readonly tags: readonly string[];
  readonly ingestionStatus: IngestionStatus;
}
