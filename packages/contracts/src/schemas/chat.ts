import { z } from 'zod';
import { idSchema, isoDateSchema, isoDateTimeSchema } from './common.js';

const filterTextSchema = z.string().trim().min(1).max(40);

export const memoryRetrievalFiltersSchema = z
  .object({
    occurredOnFrom: isoDateSchema.optional(),
    occurredOnTo: isoDateSchema.optional(),
    category: filterTextSchema.optional(),
    tags: z.array(filterTextSchema).max(20).optional(),
  })
  .superRefine((filters, context) => {
    if (
      filters.occurredOnFrom !== undefined &&
      filters.occurredOnTo !== undefined &&
      filters.occurredOnFrom > filters.occurredOnTo
    ) {
      context.addIssue({
        code: 'custom',
        path: ['occurredOnTo'],
        message: 'End date must not precede start date.',
      });
    }
  });

export const createMessageRequestSchema = z.object({
  requestId: idSchema,
  question: z.string().trim().min(1).max(2_000),
  filters: memoryRetrievalFiltersSchema.optional(),
});

export const citationSchema = z.object({
  memoryId: idSchema,
  title: z.string().min(1).max(120),
  relevance: z.number().min(0).max(1),
});

export const groundedAnswerSchema = z
  .object({
    answer: z.string().min(1).max(10_000),
    citations: z.array(citationSchema),
    abstained: z.boolean(),
  })
  .superRefine((answer, context) => {
    if (!answer.abstained && answer.citations.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A grounded answer requires at least one citation.',
        path: ['citations'],
      });
    }
  });

export const modelGroundedAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(10_000),
  citedMemoryIds: z.array(idSchema).max(5),
  abstained: z.boolean(),
});

export const conversationSummarySchema = z.object({
  conversationId: idSchema,
  title: z.string().min(1).max(120),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const chatTurnSchema = z.object({
  turnId: idSchema,
  requestId: idSchema,
  question: z.string().min(1).max(2_000),
  filters: memoryRetrievalFiltersSchema.optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']),
  createdAt: isoDateTimeSchema,
  answer: z.string().min(1).max(10_000).optional(),
  citations: z.array(citationSchema).optional(),
  abstained: z.boolean().optional(),
  failureCode: z.enum(['DEPENDENCY_FAILURE', 'TIMEOUT', 'INVALID_MODEL_OUTPUT']).optional(),
});

export const conversationSchema = conversationSummarySchema.extend({
  turns: z.array(chatTurnSchema),
  nextCursor: z.string().min(1).optional(),
});

export const conversationListSchema = z.object({
  items: z.array(conversationSummarySchema),
  nextCursor: z.string().min(1).optional(),
});

export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;
export type MemoryRetrievalFilters = z.infer<typeof memoryRetrievalFiltersSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ChatTurn = z.infer<typeof chatTurnSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
