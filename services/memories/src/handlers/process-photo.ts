import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDbMemoryRepository } from '../adapters/dynamodb-memory-repository.js';
import { createJsonLogger, createMetrics } from '@relationship-rag/observability';

interface SqsEvent {
  readonly Records: readonly { readonly body: string }[];
}
interface S3Event {
  readonly Records: readonly {
    readonly s3: {
      readonly bucket: { readonly name: string };
      readonly object: { readonly key: string };
    };
  }[];
}
const asBuffer = async (body: AsyncIterable<Uint8Array> | undefined): Promise<Buffer> => {
  if (body === undefined) throw new Error('Missing S3 body.');
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

export const handler = async (event: SqsEvent): Promise<void> => {
  const tableName = process.env['APPLICATION_TABLE_NAME'];
  const bucket = process.env['MEDIA_BUCKET_NAME'];
  if (tableName === undefined || bucket === undefined)
    throw new Error('Photo processor configuration is required.');
  const repository = new DynamoDbMemoryRepository(tableName);
  const s3 = new S3Client({});
  const logger = createJsonLogger();
  const metrics = createMetrics('media');
  for (const message of event.Records) {
    const notification = JSON.parse(message.body) as S3Event;
    for (const record of notification.Records) {
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      const parts = key.split('/');
      if (parts.length !== 4 || parts[0] !== 'staging') continue;
      const coupleId = parts[1];
      const memoryId = parts[2];
      if (coupleId === undefined || memoryId === undefined) continue;
      const memory = await repository.findById(coupleId, memoryId);
      const photo = memory?.photos.find((item) => item.stagingKey === key);
      if (
        memory === null ||
        memory === undefined ||
        photo === undefined ||
        photo.status !== 'PENDING'
      ) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        continue;
      }
      try {
        const source = await asBuffer(
          (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body as
            AsyncIterable<Uint8Array> | undefined,
        );
        if (source.byteLength > 10 * 1024 * 1024)
          throw new Error('Photo exceeds the upload limit.');
        const sharp = (await import('sharp')).default;
        const image = sharp(source, { animated: false, limitInputPixels: 40_000_000 });
        const metadata = await image.metadata();
        if (metadata.pages !== undefined && metadata.pages > 1)
          throw new Error('Animated images are not supported.');
        const displayKey = `display/${coupleId}/${memoryId}/${photo.photoId}.webp`;
        const thumbnailKey = `thumbnail/${coupleId}/${memoryId}/${photo.photoId}.webp`;
        await Promise.all([
          s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: displayKey,
              Body: await image
                .rotate()
                .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 82 })
                .toBuffer(),
              ContentType: 'image/webp',
            }),
          ),
          s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: thumbnailKey,
              Body: await image
                .rotate()
                .resize({ width: 640, height: 640, fit: 'cover', withoutEnlargement: true })
                .webp({ quality: 75 })
                .toBuffer(),
              ContentType: 'image/webp',
            }),
          ),
        ]);
        await repository.update(
          {
            ...memory,
            version: memory.version + 1,
            updatedAt: new Date().toISOString(),
            photos: memory.photos.map((item) =>
              item.photoId === photo.photoId
                ? { ...item, status: 'READY', displayKey, thumbnailKey }
                : item,
            ),
          },
          memory.version,
        );
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        logger.log('warn', 'media.processing.failed', {
          failureCode: 'PHOTO_PROCESSING_FAILED',
        });
        metrics.put('RecordFailure', 1);
        const latest = await repository.findById(coupleId, memoryId);
        if (latest !== null)
          await repository.update(
            {
              ...latest,
              version: latest.version + 1,
              updatedAt: new Date().toISOString(),
              photos: latest.photos.map((item) =>
                item.photoId === photo.photoId ? { ...item, status: 'FAILED' } : item,
              ),
            },
            latest.version,
          );
      }
    }
  }
};
