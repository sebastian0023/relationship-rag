import { z } from 'zod';
import { idSchema } from './common.js';

export const createMessageRequestSchema = z.object({
  question: z.string().trim().min(1).max(2_000),
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

export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;
