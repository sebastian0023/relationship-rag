import { describe, expect, it, vi } from 'vitest';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createInboxHandler } from './inbox.js';

const event = (
  method: string,
  rawPath: string,
  queryStringParameters?: Record<string, string>,
) => ({
  rawPath,
  ...(queryStringParameters === undefined ? {} : { queryStringParameters }),
  requestContext: {
    requestId: 'request-1',
    http: { method },
    authorizer: { jwt: { claims: { sub: 'partner-1', 'cognito:groups': ['PARTNER'] } } },
  },
});

const handlerFor = (status: string, role: string) => {
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetCommand) return { Item: { status, role } };
    throw new Error('Unexpected membership command.');
  });
  return {
    handler: createInboxHandler('test-table', 'couple-1', { log: vi.fn() }, {
      send,
    } as unknown as DynamoDBDocumentClient),
    send,
  };
};

describe('inbox HTTP handler', () => {
  it.each([
    ['GET', '/inbox', { limit: '-1' }],
    ['GET', '/inbox/not-a-uuid', undefined],
    ['PATCH', '/inbox/not-a-uuid/read', undefined],
  ])('rejects malformed %s %s before accessing inbox records', async (method, path, query) => {
    const { handler, send } = handlerFor('ACTIVE', 'PARTNER');
    const result = await handler(event(method, path, query));
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
    ['RESERVED', 'PARTNER'],
    ['ACTIVE', 'OWNER'],
  ])('rejects an inactive or role-mismatched member', async (status, role) => {
    const { handler } = handlerFor(status, role);
    const result = await handler(event('GET', '/inbox'));
    expect(result.statusCode).toBe(403);
    expect(result.headers['x-correlation-id']).toBe('request-1');
    expect(JSON.parse(result.body)).toMatchObject({ code: 'FORBIDDEN' });
  });
});
