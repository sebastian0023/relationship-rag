import { randomUUID } from 'node:crypto';
import {
  createMessageRequestSchema,
  conversationListSchema,
  verifiedIdentitySchema,
  type ApiError,
} from '@relationship-rag/contracts';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  ResourceNotFoundError,
} from '@relationship-rag/domain';
import {
  createJsonLogger,
  createMetrics,
  currentTraceId,
  type Logger,
} from '@relationship-rag/observability';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockGroundedGenerator } from '../adapters/bedrock-grounded-generator.js';
import { BedrockMemoryRetriever } from '../adapters/bedrock-memory-retriever.js';
import {
  DynamoDbCanonicalMemoryLookup,
  DynamoDbConversationRepository,
} from '../adapters/dynamodb-conversation-repository.js';
import { ConversationService } from '../application/conversation-service.js';

interface Event {
  readonly rawPath: string;
  readonly body?: string;
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
const parseBody = (body: string | undefined): unknown => JSON.parse(body ?? '{}');
const groups = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? value
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

export const createChatHandler = (
  tableName: string,
  coupleId: string,
  knowledgeBaseId: string,
  logger: Logger = createJsonLogger(),
) => {
  const conversations = new DynamoDbConversationRepository(tableName);
  const lookup = new DynamoDbCanonicalMemoryLookup(tableName);
  const generator = new BedrockGroundedGenerator();
  const service = new ConversationService(
    conversations,
    new BedrockMemoryRetriever(knowledgeBaseId, lookup),
    generator,
    generator,
    { next: randomUUID },
    { now: () => new Date().toISOString() },
    0.5,
    Number(process.env['AI_DEADLINE_MS'] ?? 24_000),
  );
  const metrics = createMetrics('chat');
  const memberships = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return async (event: Event): Promise<Response> => {
    const correlationId = event.requestContext.requestId;
    const startedAt = Date.now();
    const respond = (statusCode: number, responseBody: unknown): Response => {
      if (statusCode < 400)
        logger.log('info', 'chat.request.completed', {
          correlationId,
          statusCode,
          latencyMs: Date.now() - startedAt,
          traceId: currentTraceId(),
        });
      const response = json(statusCode, responseBody);
      return {
        ...response,
        headers: { ...response.headers, 'x-correlation-id': correlationId },
      };
    };
    try {
      const identity = verifiedIdentitySchema.parse({
        userId: event.requestContext.authorizer?.jwt?.claims?.['sub'],
        groups: groups(event.requestContext.authorizer?.jwt?.claims?.['cognito:groups']),
      });
      const membership = await memberships.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `COUPLE#${coupleId}`, SK: `MEMBER#${identity.userId}` },
          ConsistentRead: true,
        }),
      );
      if (
        membership.Item?.['status'] !== 'ACTIVE' ||
        membership.Item['role'] !== identity.groups[0] ||
        identity.groups.length !== 1
      )
        throw new AuthorizationError();
      const method = event.requestContext.http.method;
      const segments = event.rawPath.split('/').filter(Boolean);
      const cursor = event.queryStringParameters?.['cursor'];
      const limit =
        event.queryStringParameters?.['limit'] === undefined
          ? undefined
          : Number(event.queryStringParameters['limit']);
      if (
        (cursor !== undefined && (cursor.length === 0 || cursor.length > 500)) ||
        (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50))
      ) {
        throw new DomainError('INVALID_REQUEST', 'Invalid pagination request.');
      }
      if (method === 'POST' && event.rawPath === '/conversations')
        return respond(201, await service.create(coupleId, identity.userId));
      if (method === 'GET' && event.rawPath === '/conversations')
        return respond(
          200,
          conversationListSchema.parse(
            await service.list(coupleId, identity.userId, cursor, limit),
          ),
        );
      if (segments[0] !== 'conversations' || segments[1] === undefined)
        throw new ResourceNotFoundError();
      const conversationId = segments[1];
      if (method === 'GET' && segments.length === 2)
        return respond(
          200,
          await service.get(coupleId, identity.userId, conversationId, cursor, limit),
        );
      if (method === 'POST' && segments[2] === 'messages' && segments.length === 3)
        return respond(
          201,
          await service.message(
            coupleId,
            identity.userId,
            conversationId,
            createMessageRequestSchema.parse(parseBody(event.body)),
          ),
        );
      throw new ResourceNotFoundError();
    } catch (caught) {
      const status =
        caught instanceof AuthorizationError
          ? 403
          : caught instanceof ResourceNotFoundError
            ? 404
            : caught instanceof ConflictError
              ? 409
              : caught instanceof DomainError || caught instanceof SyntaxError
                ? 400
                : 503;
      logger.log(status >= 500 ? 'error' : 'warn', 'chat.request.completed', {
        correlationId,
        statusCode: status,
        traceId: currentTraceId(),
        ...(status >= 500
          ? {
              failureType:
                caught instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(caught.name)
                  ? caught.name
                  : 'Unknown',
            }
          : {}),
      });
      if (status >= 500) metrics.put('DependencyFailure', 1);
      const error: ApiError = {
        code:
          status === 409
            ? 'CONFLICT'
            : status === 404
              ? 'NOT_FOUND'
              : status === 403
                ? 'FORBIDDEN'
                : status === 400
                  ? 'INVALID_REQUEST'
                  : 'DEPENDENCY_FAILURE',
        message:
          status === 404
            ? 'The requested resource was not found.'
            : status === 403
              ? 'You are not authorized to access this resource.'
              : status === 409
                ? 'This request is already being processed.'
                : status === 400
                  ? 'The request is invalid.'
                  : 'The assistant is temporarily unavailable. Please retry.',
        correlationId,
      };
      return respond(status, error);
    }
  };
};

const tableName = process.env['APPLICATION_TABLE_NAME'];
const coupleId = process.env['COUPLE_ID'];
const knowledgeBaseId = process.env['KNOWLEDGE_BASE_ID'];
export const handler = async (event: Event): Promise<Response> => {
  if (tableName === undefined || coupleId === undefined || knowledgeBaseId === undefined)
    throw new Error('Chat handler configuration is required.');
  return createChatHandler(tableName, coupleId, knowledgeBaseId)(event);
};
