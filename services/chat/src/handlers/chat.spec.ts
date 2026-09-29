import { describe, expect, it, vi } from 'vitest';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createChatHandler } from './chat.js';

describe('chat HTTP handler', () => {
  it('returns a safe 400 for a schema-invalid question', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: { status: 'ACTIVE', role: 'OWNER' } };
      throw new Error('Unexpected membership command.');
    });
    const handler = createChatHandler(
      'test-table',
      'couple-1',
      'knowledge-base-1',
      { log: vi.fn() },
      { send } as unknown as DynamoDBDocumentClient,
    );
    const result = await handler({
      rawPath: '/conversations/11111111-1111-4111-8111-111111111111/messages',
      body: JSON.stringify({ requestId: 'not-a-uuid', question: 'Question text' }),
      requestContext: {
        requestId: 'request-1',
        http: { method: 'POST' },
        authorizer: { jwt: { claims: { sub: 'owner-1', 'cognito:groups': ['OWNER'] } } },
      },
    });
    expect(result.statusCode).toBe(400);
    expect(result.headers['x-correlation-id']).toBe('request-1');
    expect(JSON.parse(result.body)).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(result.body).not.toContain('Question text');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
