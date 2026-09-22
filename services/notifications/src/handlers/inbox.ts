import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  cardListQuerySchema,
  idSchema,
  inboxItemSchema,
  inboxListSchema,
  verifiedIdentitySchema,
  type ApiError,
} from '@relationship-rag/contracts';
import { AuthorizationError, DomainError, ResourceNotFoundError } from '@relationship-rag/domain';
import { createJsonLogger } from '@relationship-rag/observability';
import { DynamoDbDeliveryRepository } from '../adapters/dynamodb-delivery-repository.js';
import { DeliveryService } from '../application/delivery.js';

interface Event {
  readonly rawPath: string;
  readonly queryStringParameters?: Record<string, string | undefined>;
  readonly requestContext: {
    readonly requestId: string;
    readonly http: { readonly method: string };
    readonly authorizer?: { readonly jwt?: { readonly claims?: Record<string, unknown> } };
  };
}
interface Response {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}
const json = (statusCode: number, body: unknown): Response => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});
const groups = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? value
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

export const createInboxHandler = (tableName: string, coupleId: string) => {
  const service = new DeliveryService(new DynamoDbDeliveryRepository(tableName));
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const logger = createJsonLogger();
  return async (event: Event): Promise<Response> => {
    const correlationId = event.requestContext.requestId;
    try {
      const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
      const identity = verifiedIdentitySchema.parse({
        userId: claims['sub'],
        groups: groups(claims['cognito:groups']),
      });
      const membership = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `COUPLE#${coupleId}`, SK: `MEMBER#${identity.userId}` },
          ConsistentRead: true,
        }),
      );
      if (
        identity.groups.length !== 1 ||
        membership.Item?.['status'] !== 'ACTIVE' ||
        membership.Item['role'] !== identity.groups[0]
      )
        throw new AuthorizationError();
      const method = event.requestContext.http.method;
      const segments = event.rawPath.split('/').filter(Boolean);
      if (method === 'GET' && event.rawPath === '/inbox') {
        const query = cardListQuerySchema.parse(event.queryStringParameters ?? {});
        return json(
          200,
          inboxListSchema.parse(
            await service.listInbox(identity.userId, query.cursor, query.limit),
          ),
        );
      }
      const rawCardId = segments[0] === 'inbox' ? segments[1] : undefined;
      if (rawCardId === undefined) throw new ResourceNotFoundError();
      const cardId = idSchema.parse(rawCardId);
      if (method === 'GET' && segments.length === 2)
        return json(200, inboxItemSchema.parse(await service.getInbox(identity.userId, cardId)));
      if (method === 'PATCH' && segments[2] === 'read' && segments.length === 3)
        return json(200, inboxItemSchema.parse(await service.markRead(identity.userId, cardId)));
      throw new ResourceNotFoundError();
    } catch (caught) {
      const status =
        caught instanceof AuthorizationError
          ? 403
          : caught instanceof ResourceNotFoundError
            ? 404
            : caught instanceof DomainError ||
                caught instanceof SyntaxError ||
                (caught as { name?: string }).name === 'ZodError'
              ? 400
              : 500;
      logger.log(status >= 500 ? 'error' : 'warn', 'inbox.request.completed', {
        correlationId,
        statusCode: status,
      });
      const error: ApiError = {
        code:
          status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 400
                ? 'INVALID_REQUEST'
                : 'INTERNAL_ERROR',
        message:
          status === 403
            ? 'You are not authorized to access this resource.'
            : status === 404
              ? 'The requested resource was not found.'
              : status === 400
                ? 'The request is invalid.'
                : 'Unable to load the inbox.',
        correlationId,
      };
      return json(status, error);
    }
  };
};
const tableName = process.env['APPLICATION_TABLE_NAME'];
const coupleId = process.env['COUPLE_ID'];
export const handler = async (event: Event): Promise<Response> => {
  if (tableName === undefined || coupleId === undefined)
    throw new Error('Inbox handler configuration is required.');
  return createInboxHandler(tableName, coupleId)(event);
};
