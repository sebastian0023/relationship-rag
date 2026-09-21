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
  readonly category?: string;
  readonly location?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly photos: readonly MemoryPhoto[];
  readonly ingestionStatus: IngestionStatus;
}

export type PhotoProcessingStatus = 'PENDING' | 'READY' | 'FAILED';

export interface MemoryPhoto {
  readonly photoId: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly status: PhotoProcessingStatus;
  readonly stagingKey?: string;
  readonly displayKey?: string;
  readonly thumbnailKey?: string;
}
