import {
  apiErrorSchema,
  memberProfileSchema,
  verifiedIdentitySchema,
  type ApiError,
} from '@relationship-rag/contracts';
import { AuthorizationError } from '@relationship-rag/domain';
import {
  createJsonLogger,
  createMetrics,
  currentTraceId,
  type Logger,
} from '@relationship-rag/observability';
import { GetMyProfile } from '../application/get-my-profile.js';
import { DynamoDbMembershipRepository } from '../adapters/dynamodb-membership-repository.js';

interface HttpEvent {
  readonly requestContext: {
    readonly requestId: string;
    readonly authorizer?: { readonly jwt?: { readonly claims?: Record<string, unknown> } };
  };
}

interface HttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const json = (statusCode: number, body: unknown): HttpResponse => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

const error = (code: string, message: string, correlationId: string): ApiError =>
  apiErrorSchema.parse({ code, message, correlationId });

const toGroups = (value: unknown): string[] => {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  if (typeof value !== 'string') return [];
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);
};

export const createGetMeHandler = (
  getMyProfile: GetMyProfile,
  logger: Logger = createJsonLogger(),
) => {
  const metrics = createMetrics('identity');
  return async (event: HttpEvent): Promise<HttpResponse> => {
    const correlationId = event.requestContext.requestId;
    const respond = (statusCode: number, responseBody: unknown): HttpResponse => {
      const response = json(statusCode, responseBody);
      return {
        ...response,
        headers: { ...response.headers, 'x-correlation-id': correlationId },
      };
    };
    const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
    const identity = verifiedIdentitySchema.safeParse({
      userId: claims['sub'],
      groups: toGroups(claims['cognito:groups']),
    });

    if (!identity.success) {
      logger.log('warn', 'identity.profile.denied', { correlationId, reason: 'invalid_claims' });
      return respond(
        403,
        error('FORBIDDEN', 'You are not authorized to access this resource.', correlationId),
      );
    }

    const startedAt = Date.now();
    try {
      const profile = memberProfileSchema.parse(await getMyProfile.execute(identity.data));
      logger.log('info', 'identity.profile.completed', {
        correlationId,
        subjectId: identity.data.userId,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
      });
      return respond(200, profile);
    } catch (caught: unknown) {
      if (caught instanceof AuthorizationError) {
        logger.log('warn', 'identity.profile.denied', {
          correlationId,
          subjectId: identity.data.userId,
          statusCode: 403,
          latencyMs: Date.now() - startedAt,
        });
        return respond(
          403,
          error('FORBIDDEN', 'You are not authorized to access this resource.', correlationId),
        );
      }

      logger.log('error', 'identity.profile.failed', {
        correlationId,
        subjectId: identity.data.userId,
        statusCode: 500,
        latencyMs: Date.now() - startedAt,
        traceId: currentTraceId(),
      });
      metrics.put('DependencyFailure', 1);
      return respond(
        500,
        error('INTERNAL_ERROR', 'Unable to retrieve your profile.', correlationId),
      );
    }
  };
};

const tableName = process.env['APPLICATION_TABLE_NAME'];
const coupleId = process.env['COUPLE_ID'];
const configuredHandler =
  tableName === undefined || coupleId === undefined
    ? undefined
    : createGetMeHandler(new GetMyProfile(coupleId, new DynamoDbMembershipRepository(tableName)));

export const handler = async (event: HttpEvent): Promise<HttpResponse> => {
  if (configuredHandler === undefined) {
    throw new Error('APPLICATION_TABLE_NAME and COUPLE_ID are required.');
  }
  return configuredHandler(event);
};
