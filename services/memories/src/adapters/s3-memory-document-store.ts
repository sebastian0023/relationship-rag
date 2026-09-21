import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SourceDocumentStore } from '../application/ingestion-coordinator.js';
import type { NormalizedMemoryDocument } from '../application/memory-document.js';

export class S3MemoryDocumentStore implements SourceDocumentStore {
  private readonly client: S3Client;
  public constructor(
    private readonly bucket: string,
    client?: S3Client,
  ) {
    this.client = client ?? new S3Client({});
  }
  public async put(document: NormalizedMemoryDocument): Promise<void> {
    await Promise.all([
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: document.key,
          Body: document.body,
          ContentType: 'text/markdown; charset=utf-8',
        }),
      ),
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: document.metadataKey,
          Body: document.metadata,
          ContentType: 'application/json',
        }),
      ),
    ]);
  }
  public async delete(coupleId: string, memoryId: string): Promise<void> {
    const key = `memories/${coupleId}/${memoryId}.md`;
    await Promise.all([
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: `${key}.metadata.json` }),
      ),
    ]);
  }
}
