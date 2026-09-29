import { describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import type { Memory } from '../domain/memory.js';
import type { DynamoDbMemoryRepository } from '../adapters/dynamodb-memory-repository.js';
import type { Logger, Metrics } from '@relationship-rag/observability';
import { createPhotoProcessor } from './process-photo.js';

const event = (key: string) => ({
  Records: [
    {
      body: JSON.stringify({
        Records: [{ s3: { bucket: { name: 'media-test' }, object: { key } } }],
      }),
    },
  ],
});
const base: Memory = {
  memoryId: 'memory-1',
  coupleId: 'couple-1',
  createdBy: 'owner-1',
  title: 'Synthetic',
  occurredOn: '2025-05-10',
  body: 'Synthetic test.',
  locale: 'en',
  tags: [],
  createdAt: '2025-05-10T12:00:00.000Z',
  updatedAt: '2025-05-10T12:00:00.000Z',
  version: 1,
  ingestionStatus: 'PENDING',
  photos: [],
};

describe('photo processor', () => {
  for (const [contentType, format] of [
    ['image/jpeg', 'jpeg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ] as const) {
    it(`converts a valid ${format} into private display and thumbnail images`, async () => {
      const key = 'staging/couple-1/memory-1/upload-1';
      const source = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .toFormat(format)
        .toBuffer();
      let memory: Memory = {
        ...base,
        photos: [{ photoId: 'photo-1', stagingKey: key, contentType, status: 'PENDING' }],
      };
      const puts: PutObjectCommand[] = [];
      const deletes: string[] = [];
      const repository = {
        findById: vi.fn(async () => memory),
        update: vi.fn(async (next: Memory, expected: number) => {
          expect(expected).toBe(memory.version);
          memory = next;
        }),
      } as unknown as Pick<DynamoDbMemoryRepository, 'findById' | 'update'>;
      const s3 = {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof GetObjectCommand)
            return {
              Body: (async function* () {
                yield source;
              })(),
            };
          if (command instanceof PutObjectCommand) {
            puts.push(command);
            return {};
          }
          if (command instanceof DeleteObjectCommand) {
            deletes.push(String(command.input.Key));
            return {};
          }
          throw new Error('Unexpected S3 command.');
        }),
      } as unknown as S3Client;
      const processor = createPhotoProcessor(repository, s3, 'media-test');
      await processor(event(key));
      expect(memory.photos[0]).toMatchObject({
        status: 'READY',
        displayKey: 'display/couple-1/memory-1/photo-1.webp',
        thumbnailKey: 'thumbnail/couple-1/memory-1/photo-1.webp',
      });
      expect(puts.map((command) => command.input.ContentType)).toEqual([
        'image/webp',
        'image/webp',
      ]);
      expect(deletes).toEqual([key]);
      await processor(event(key));
      expect(puts).toHaveLength(2);
      expect(deletes).toEqual([key, key]);
    });
  }

  it('marks a mismatched or corrupt upload failed without publishing a display image', async () => {
    const key = 'staging/couple-1/memory-1/upload-2';
    let source = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    let memory: Memory = {
      ...base,
      photos: [
        { photoId: 'photo-2', stagingKey: key, contentType: 'image/jpeg', status: 'PENDING' },
      ],
    };
    const puts: PutObjectCommand[] = [];
    const logger = { log: vi.fn() } as unknown as Logger;
    const metrics = { put: vi.fn() } as unknown as Metrics;
    const processor = createPhotoProcessor(
      {
        findById: vi.fn(async () => memory),
        update: vi.fn(async (next: Memory) => {
          memory = next;
        }),
      } as unknown as DynamoDbMemoryRepository,
      {
        send: vi.fn(async (command: unknown) => {
          if (command instanceof GetObjectCommand)
            return {
              Body: (async function* () {
                yield source;
              })(),
            };
          if (command instanceof PutObjectCommand) {
            puts.push(command);
            return {};
          }
          return {};
        }),
      } as unknown as S3Client,
      'media-test',
      logger,
      metrics,
    );
    await processor(event(key));
    expect(memory.photos[0]?.status).toBe('FAILED');
    expect(puts).toHaveLength(0);
    expect(metrics.put).toHaveBeenCalledWith('RecordFailure', 1);
    source = Buffer.from('not an image');
    memory = {
      ...base,
      photos: [
        { photoId: 'photo-2', stagingKey: key, contentType: 'image/jpeg', status: 'PENDING' },
      ],
    };
    await processor(event(key));
    expect(memory.photos[0]?.status).toBe('FAILED');
    expect(puts).toHaveLength(0);
    expect(metrics.put).toHaveBeenCalledTimes(2);
  });
});
