import { describe, expect, it, vi } from 'vitest';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createMemoriesHandler } from './memories.js';

describe('memories HTTP handler', () => {
  it('returns a safe 400 for a schema-invalid memory request', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetCommand) return { Item: { status: 'ACTIVE', role: 'OWNER' } };
      throw new Error('Unexpected membership command.');
    });
    const handler = createMemoriesHandler(
      'test-table',
      'couple-1',
      'test-bucket',
      { log: vi.fn() },
      { send } as unknown as DynamoDBDocumentClient,
    );
    const result = await handler({
      rawPath: '/memories',
      body: JSON.stringify({
        title: 'Invalid',
        occurredOn: '2025-02-30',
        body: 'Text',
        locale: 'en',
      }),
      requestContext: {
        requestId: 'request-1',
        http: { method: 'POST' },
        authorizer: { jwt: { claims: { sub: 'owner-1', 'cognito:groups': ['OWNER'] } } },
      },
    });
    expect(result.statusCode).toBe(400);
    expect(result.headers['x-correlation-id']).toBe('request-1');
    expect(JSON.parse(result.body)).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(result.body).not.toContain('2025-02-30');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
