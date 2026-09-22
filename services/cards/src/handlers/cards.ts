import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  cardListQuerySchema,
  cardListSchema,
  cardRecipientsSchema,
  cardSchema,
  generateCardRequestSchema,
  generatedCardDraftSchema,
  idSchema,
  saveCardRequestSchema,
  sendCardRequestSchema,
  sendCardResponseSchema,
  updateCardRequestSchema,
  verifiedIdentitySchema,
  type ApiError,
} from '@relationship-rag/contracts';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  ResourceNotFoundError,
} from '@relationship-rag/domain';
import { createJsonLogger, type Logger } from '@relationship-rag/observability';
import { DynamoDbCardRepository } from '../adapters/dynamodb-card-repository.js';
import { BedrockCardGenerator } from '../adapters/bedrock-card-generator.js';
import { AwsDeliveryDispatcher } from '../adapters/aws-delivery-dispatcher.js';
import { CardService } from '../application/card-service.js';

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

export const createCardsHandler = (
  tableName: string,
  coupleId: string,
  queueUrl: string,
  queueArn: string,
  schedulerRoleArn: string,
  schedulerDlqArn: string,
  logger: Logger = createJsonLogger(),
) => {
  const repository = new DynamoDbCardRepository(tableName);
  const service = new CardService(
    repository,
    new BedrockCardGenerator(),
    { next: randomUUID },
    { now: () => new Date().toISOString() },
    new AwsDeliveryDispatcher(queueUrl, queueArn, schedulerRoleArn, schedulerDlqArn),
  );
  const memberships = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return async (event: Event): Promise<Response> => {
    const correlationId = event.requestContext.requestId;
    try {
      const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
      const identity = verifiedIdentitySchema.parse({
        userId: claims['sub'],
        groups: groups(claims['cognito:groups']),
      });
      const membership = await memberships.send(
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
      const body = (): unknown => JSON.parse(event.body ?? '{}');
      if (method === 'GET' && event.rawPath === '/cards/recipients')
        return json(
          200,
          cardRecipientsSchema.parse({
            items: await service.recipients(coupleId, identity.userId),
          }),
        );
      if (method === 'POST' && event.rawPath === '/cards/generate')
        return json(
          200,
          generatedCardDraftSchema.parse(
            await service.generate(
              coupleId,
              identity.userId,
              generateCardRequestSchema.parse(body()),
            ),
          ),
        );
      if (method === 'POST' && event.rawPath === '/cards')
        return json(
          201,
          cardSchema.parse(
            await service.save(coupleId, identity.userId, saveCardRequestSchema.parse(body())),
          ),
        );
      if (method === 'GET' && event.rawPath === '/cards') {
        const query = cardListQuerySchema.parse(event.queryStringParameters ?? {});
        return json(
          200,
          cardListSchema.parse(
            await service.list(coupleId, identity.userId, query.cursor, query.limit),
          ),
        );
      }
      const rawCardId = segments[0] === 'cards' ? segments[1] : undefined;
      if (rawCardId === undefined) throw new ResourceNotFoundError();
      const cardId = idSchema.parse(rawCardId);
      if (method === 'GET' && segments.length === 2)
        return json(200, cardSchema.parse(await service.get(coupleId, identity.userId, cardId)));
      if (method === 'PATCH' && segments.length === 2)
        return json(
          200,
          cardSchema.parse(
            await service.update(
              coupleId,
              identity.userId,
              cardId,
              updateCardRequestSchema.parse(body()),
            ),
          ),
        );
      if (method === 'DELETE' && segments.length === 2) {
        const version = Number(event.queryStringParameters?.['version']);
        if (!Number.isInteger(version) || version < 1)
          throw new DomainError('INVALID_REQUEST', 'A valid version is required.');
        await service.delete(coupleId, identity.userId, cardId, version);
        return { statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' };
      }
      if (method === 'POST' && segments[2] === 'send' && segments.length === 3)
        return json(
          202,
          sendCardResponseSchema.parse(
            await service.send(
              coupleId,
              identity.userId,
              cardId,
              sendCardRequestSchema.parse(body()),
            ),
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
              : caught instanceof DomainError ||
                  caught instanceof SyntaxError ||
                  (caught as { name?: string }).name === 'ZodError'
                ? 400
                : 503;
      logger.log(status >= 500 ? 'error' : 'warn', 'cards.request.completed', {
        correlationId,
        statusCode: status,
      });
      const error: ApiError = {
        code:
          status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 409
                ? 'CONFLICT'
                : status === 400
                  ? 'INVALID_REQUEST'
                  : 'DEPENDENCY_FAILURE',
        message:
          status === 403
            ? 'You are not authorized to access this resource.'
            : status === 404
              ? 'The requested resource was not found.'
              : status === 409
                ? 'This card changed or can no longer be edited.'
                : status === 400
                  ? 'The request is invalid.'
                  : 'Card service is temporarily unavailable.',
        correlationId,
      };
      return json(status, error);
    }
  };
};

const tableName = process.env['APPLICATION_TABLE_NAME'];
const coupleId = process.env['COUPLE_ID'];
const queueUrl = process.env['DELIVERY_QUEUE_URL'];
const queueArn = process.env['DELIVERY_QUEUE_ARN'];
const schedulerRoleArn = process.env['SCHEDULER_ROLE_ARN'];
const schedulerDlqArn = process.env['SCHEDULER_DLQ_ARN'];
export const handler = async (event: Event): Promise<Response> => {
  if (
    [tableName, coupleId, queueUrl, queueArn, schedulerRoleArn, schedulerDlqArn].some(
      (value) => value === undefined,
    )
  )
    throw new Error('Card handler configuration is required.');
  return createCardsHandler(
    tableName!,
    coupleId!,
    queueUrl!,
    queueArn!,
    schedulerRoleArn!,
    schedulerDlqArn!,
  )(event);
};
