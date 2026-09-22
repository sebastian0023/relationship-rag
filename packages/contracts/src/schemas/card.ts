import { z } from 'zod';
import { idSchema, isoDateTimeSchema, localeSchema } from './common.js';

export const cardToneSchema = z.enum(['AFFECTIONATE', 'PLAYFUL', 'GRATEFUL', 'REFLECTIVE']);
export const cardStatusSchema = z.enum(['DRAFT', 'QUEUED', 'SCHEDULED', 'SENT', 'DELIVERY_FAILED']);

const titleSchema = z.string().trim().min(1).max(120);
const bodySchema = z.string().trim().min(1).max(10_000);
const occasionSchema = z.string().trim().min(1).max(120);
const memoryIdsSchema = z.array(idSchema).max(20).default([]);

export const cardRecipientSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1).max(100),
});

export const cardRecipientsSchema = z.object({ items: z.array(cardRecipientSchema) });

export const generateCardRequestSchema = z.object({
  recipientUserId: z.string().min(1),
  occasion: occasionSchema,
  tone: cardToneSchema,
  locale: localeSchema,
  memoryIds: memoryIdsSchema,
});

export const generatedCardDraftSchema = z
  .object({
    title: titleSchema,
    body: bodySchema,
    citedMemoryIds: z.array(idSchema).max(20),
  })
  .superRefine((draft, context) => {
    if (new Set(draft.citedMemoryIds).size !== draft.citedMemoryIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['citedMemoryIds'],
        message: 'Citations must be unique.',
      });
    }
  });

export const modelCardDraftSchema = generatedCardDraftSchema.extend({
  insufficientEvidence: z.boolean(),
});

export const cardDraftSchema = generatedCardDraftSchema;

export const saveCardRequestSchema = generateCardRequestSchema.extend({
  clientRequestId: idSchema,
  title: titleSchema,
  body: bodySchema,
  citedMemoryIds: z.array(idSchema).max(20),
});

export const updateCardRequestSchema = z.object({
  version: z.number().int().positive(),
  occasion: occasionSchema,
  tone: cardToneSchema,
  locale: localeSchema,
  memoryIds: memoryIdsSchema,
  title: titleSchema,
  body: bodySchema,
  citedMemoryIds: z.array(idSchema).max(20),
});

export const cardSchema = z.object({
  cardId: idSchema,
  senderUserId: z.string().min(1),
  recipientUserId: z.string().min(1),
  recipientDisplayName: z.string().min(1).max(100),
  occasion: occasionSchema,
  tone: cardToneSchema,
  locale: localeSchema,
  memoryIds: z.array(idSchema).max(20),
  citedMemoryIds: z.array(idSchema).max(20),
  title: titleSchema,
  body: bodySchema,
  status: cardStatusSchema,
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deliveryAt: isoDateTimeSchema.optional(),
  deliveredAt: isoDateTimeSchema.optional(),
});

export const cardListQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const cardListSchema = z.object({
  items: z.array(cardSchema),
  nextCursor: z.string().min(1).optional(),
});

export const sendCardRequestSchema = z.object({
  confirmed: z.literal(true),
  version: z.number().int().positive(),
  deliveryAt: isoDateTimeSchema.optional(),
  idempotencyKey: z.string().min(16).max(128),
});

export const sendCardResponseSchema = z.object({
  deliveryId: idSchema,
  cardId: idSchema,
  status: z.enum(['QUEUED', 'SCHEDULED', 'SENT']),
  deliveryAt: isoDateTimeSchema,
});

export const deliveryEventSchema = z.object({
  deliveryId: idSchema,
  coupleId: z.string().min(1),
});

export const deliveryRecordSchema = z.object({
  deliveryId: idSchema,
  coupleId: z.string().min(1),
  cardId: idSchema,
  senderUserId: z.string().min(1),
  senderDisplayName: z.string().min(1).max(100),
  recipientUserId: z.string().min(1),
  cardCreatedAt: isoDateTimeSchema,
  occasion: occasionSchema,
  tone: cardToneSchema,
  locale: localeSchema,
  title: titleSchema,
  body: bodySchema,
  citedMemoryIds: z.array(idSchema).max(20),
  deliveryAt: isoDateTimeSchema,
  status: z.enum(['PENDING', 'DISPATCHED', 'DELIVERED', 'FAILED']),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: isoDateTimeSchema,
  deliveredAt: isoDateTimeSchema.optional(),
  failureCode: z.string().min(1).max(80).optional(),
});

export const inboxItemSchema = z.object({
  cardId: idSchema,
  deliveryId: idSchema,
  senderUserId: z.string().min(1),
  senderDisplayName: z.string().min(1).max(100),
  recipientUserId: z.string().min(1),
  occasion: occasionSchema,
  tone: cardToneSchema,
  locale: localeSchema,
  title: titleSchema,
  body: bodySchema,
  citedMemoryIds: z.array(idSchema).max(20),
  deliveredAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.optional(),
});

export const inboxListSchema = z.object({
  items: z.array(inboxItemSchema),
  nextCursor: z.string().min(1).optional(),
});

export type CardTone = z.infer<typeof cardToneSchema>;
export type CardStatus = z.infer<typeof cardStatusSchema>;
export type CardRecipient = z.infer<typeof cardRecipientSchema>;
export type GenerateCardRequest = z.infer<typeof generateCardRequestSchema>;
export type GeneratedCardDraft = z.infer<typeof generatedCardDraftSchema>;
export type CardDraft = GeneratedCardDraft;
export type SaveCardRequest = z.infer<typeof saveCardRequestSchema>;
export type UpdateCardRequest = z.infer<typeof updateCardRequestSchema>;
export type CardDto = z.infer<typeof cardSchema>;
export type CardList = z.infer<typeof cardListSchema>;
export type SendCardRequest = z.infer<typeof sendCardRequestSchema>;
export type SendCardResponse = z.infer<typeof sendCardResponseSchema>;
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;
export type DeliveryRecord = z.infer<typeof deliveryRecordSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type InboxList = z.infer<typeof inboxListSchema>;
