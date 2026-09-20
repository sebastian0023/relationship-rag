import { z } from 'zod';
import { idSchema, isoDateSchema, isoDateTimeSchema, localeSchema } from './common.js';

const memoryTitleSchema = z.string().trim().min(1).max(120);
const memoryBodySchema = z.string().trim().min(1).max(10_000);
const memoryTagSchema = z.string().trim().min(1).max(40);

export const createMemoryRequestSchema = z.object({
  title: memoryTitleSchema,
  occurredOn: isoDateSchema,
  body: memoryBodySchema,
  locale: localeSchema,
  tags: z.array(memoryTagSchema).max(20).default([]),
  location: z.string().trim().min(1).max(200).optional(),
});

export const memorySchema = createMemoryRequestSchema.extend({
  memoryId: idSchema,
  coupleId: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  ingestionStatus: z.enum(['NOT_REQUESTED', 'PENDING', 'INDEXED', 'FAILED']),
});

export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>;
export type MemoryDto = z.infer<typeof memorySchema>;
