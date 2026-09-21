import { z } from 'zod';
import { idSchema, isoDateSchema, isoDateTimeSchema, localeSchema } from './common.js';

const memoryTitleSchema = z.string().trim().min(1).max(120);
const memoryBodySchema = z.string().trim().min(1).max(10_000);
const memoryTagSchema = z.string().trim().min(1).max(40);
const memoryCategorySchema = z.string().trim().min(1).max(40);
export const photoContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const photoProcessingStatusSchema = z.enum(['PENDING', 'READY', 'FAILED']);

export const createMemoryRequestSchema = z.object({
  title: memoryTitleSchema,
  occurredOn: isoDateSchema,
  body: memoryBodySchema,
  locale: localeSchema,
  tags: z.array(memoryTagSchema).max(20).default([]),
  category: memoryCategorySchema.optional(),
  location: z.string().trim().min(1).max(200).optional(),
});

export const memorySchema = createMemoryRequestSchema.extend({
  memoryId: idSchema,
  coupleId: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  ingestionStatus: z.enum(['NOT_REQUESTED', 'PENDING', 'INDEXED', 'FAILED']),
  version: z.number().int().positive(),
  photos: z
    .array(
      z.object({
        photoId: idSchema,
        status: photoProcessingStatusSchema,
        contentType: photoContentTypeSchema,
        displayUrl: z.url().optional(),
        thumbnailUrl: z.url().optional(),
      }),
    )
    .max(10),
});

export const updateMemoryRequestSchema = createMemoryRequestSchema.extend({
  version: z.number().int().positive(),
});

export const ingestionStatusSchema = z.object({
  status: z.enum(['NOT_REQUESTED', 'PENDING', 'INDEXED', 'FAILED']),
  requestedAt: isoDateTimeSchema.optional(),
  indexedAt: isoDateTimeSchema.optional(),
  failureCode: z.string().min(1).max(80).optional(),
  retryable: z.boolean(),
});

export const timelineQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const timelineResponseSchema = z.object({
  items: z.array(memorySchema),
  nextCursor: z.string().min(1).optional(),
});

export const createUploadRequestSchema = z.object({
  contentType: photoContentTypeSchema,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});

export const uploadInstructionsSchema = z.object({
  photoId: idSchema,
  url: z.url(),
  fields: z.record(z.string(), z.string()),
  expiresAt: isoDateTimeSchema,
});

export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>;
export type MemoryDto = z.infer<typeof memorySchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;
export type UploadInstructions = z.infer<typeof uploadInstructionsSchema>;
export type IngestionStatusResponse = z.infer<typeof ingestionStatusSchema>;
