import { z } from 'zod';
import { idSchema, isoDateTimeSchema, localeSchema } from './common.js';

export const cardToneSchema = z.enum(['AFFECTIONATE', 'PLAYFUL', 'GRATEFUL', 'REFLECTIVE']);
export const cardStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'SENT', 'DELIVERY_FAILED']);

export const generateCardRequestSchema = z.object({
  recipientUserId: z.string().min(1),
  occasion: z.string().trim().min(1).max(120),
  tone: cardToneSchema,
  locale: localeSchema,
  memoryIds: z.array(idSchema).max(20).default([]),
});

export const cardDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(10_000),
  citedMemoryIds: z.array(idSchema),
});

export const sendCardRequestSchema = z.object({
  deliveryAt: isoDateTimeSchema.optional(),
  idempotencyKey: z.string().min(16).max(128),
});

export type CardTone = z.infer<typeof cardToneSchema>;
export type CardStatus = z.infer<typeof cardStatusSchema>;
export type GenerateCardRequest = z.infer<typeof generateCardRequestSchema>;
export type CardDraft = z.infer<typeof cardDraftSchema>;
export type SendCardRequest = z.infer<typeof sendCardRequestSchema>;
