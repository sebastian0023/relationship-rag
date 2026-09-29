import { describe, expect, it, vi } from 'vitest';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createCardsHandler } from './cards.js';

const cardId = '11111111-1111-4111-8111-111111111111';
const event = (method: string, rawPath: string, body?: string) => ({
  rawPath,
  ...(body === undefined ? {} : { body }),
  requestContext: {
    requestId: 'request-1',
    http: { method },
    authorizer: { jwt: { claims: { sub: 'owner-1', 'cognito:groups': ['OWNER'] } } },
  },
});

const handlerFor = (status: string, role: string) => {
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetCommand) return { Item: { status, role } };
    throw new Error('Unexpected membership command.');
  });
  const handler = createCardsHandler(
    'test-table',
    'couple-1',
    'queue-url',
    'queue-arn',
    'role-arn',
    'dlq-arn',
    { log: vi.fn() },
    { send } as unknown as DynamoDBDocumentClient,
  );
  return { handler, send };
};

describe('card HTTP handler', () => {
  it.each([
    ['POST', '/cards/generate', '{}'],
    ['POST', '/cards', '{}'],
    ['PATCH', `/cards/${cardId}`, '{}'],
    ['POST', `/cards/${cardId}/send`, '{}'],
    ['DELETE', `/cards/${cardId}`, undefined],
    ['GET', '/cards/not-a-uuid', undefined],
  ])('rejects malformed %s %s without calling card dependencies', async (method, path, body) => {
    const { handler, send } = handlerFor('ACTIVE', 'OWNER');
    const result = await handler(event(method, path, body));
    expect(result.statusCode).toBe(400);
    expect(result.headers['x-correlation-id']).toBe('request-1');
    expect(JSON.parse(result.body)).toEqual({
      code: 'INVALID_REQUEST',
      message: 'The request is invalid.',
      correlationId: 'request-1',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['RESERVED', 'OWNER'],
    ['ACTIVE', 'PARTNER'],
  ])('rejects an inactive or role-mismatched membership', async (status, role) => {
    const { handler } = handlerFor(status, role);
    const result = await handler(event('GET', '/cards'));
    expect(result.statusCode).toBe(403);
    expect(result.headers['x-correlation-id']).toBe('request-1');
    expect(JSON.parse(result.body)).toMatchObject({ code: 'FORBIDDEN' });
  });
});
