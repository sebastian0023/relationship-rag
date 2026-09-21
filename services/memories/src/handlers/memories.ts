import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  createMemoryRequestSchema,
  createUploadRequestSchema,
  timelineQuerySchema,
  updateMemoryRequestSchema,
  type ApiError,
  verifiedIdentitySchema,
} from '@relationship-rag/contracts';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  ResourceNotFoundError,
} from '@relationship-rag/domain';
import { createJsonLogger, type Logger } from '@relationship-rag/observability';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbMemoryRepository } from '../adapters/dynamodb-memory-repository.js';
import { MemoryService } from '../application/memory-service.js';

interface Event {
  readonly rawPath: string;
  readonly requestContext: {
    readonly requestId: string;
    readonly http: { readonly method: string };
    readonly authorizer?: { readonly jwt?: { readonly claims?: Record<string, unknown> } };
  };
  readonly body?: string;
  readonly queryStringParameters?: Record<string, string | undefined>;
}
interface Response {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}
const json = (statusCode: number, body: unknown): Response => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body, (key, value) =>
    ['stagingKey', 'displayKey', 'thumbnailKey'].includes(key) ? undefined : value,
  ),
});
const parseBody = (body: string | undefined): unknown => JSON.parse(body ?? '{}');
const groups = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string')
    : typeof value === 'string'
      ? value
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

export const createMemoriesHandler = (
  tableName: string,
  coupleId: string,
  mediaBucket: string,
  logger: Logger = createJsonLogger(),
) => {
  const service = new MemoryService(new DynamoDbMemoryRepository(tableName));
  const membershipClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = new S3Client({});
  return async (event: Event): Promise<Response> => {
    const correlationId = event.requestContext.requestId;
    try {
      const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
      const identity = verifiedIdentitySchema.parse({
        userId: claims['sub'],
        groups: groups(claims['cognito:groups']),
      });
      const membership = await membershipClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: `COUPLE#${coupleId}`, SK: `MEMBER#${identity.userId}` },
          ConsistentRead: true,
        }),
      );
      if (
        membership.Item === undefined ||
        membership.Item['status'] !== 'ACTIVE' ||
        membership.Item['role'] !== identity.groups[0] ||
        identity.groups.length !== 1
      )
        throw new AuthorizationError();
      const method = event.requestContext.http.method;
      const segments = event.rawPath.split('/').filter(Boolean);
      if (method === 'GET' && event.rawPath === '/timeline') {
        const query = timelineQuerySchema.parse(event.queryStringParameters ?? {});
        const timeline = await service.list(coupleId, query.cursor, query.limit);
        return json(200, timeline);
      }
      if (method === 'POST' && event.rawPath === '/memories')
        return json(
          201,
          await service.create(
            coupleId,
            identity.userId,
            createMemoryRequestSchema.parse(parseBody(event.body)),
          ),
        );
      const memoryId = segments[1];
      if (memoryId === undefined || segments[0] !== 'memories') throw new ResourceNotFoundError();
      if (method === 'GET' && segments.length === 2)
        return json(200, await withViewUrls(service, coupleId, memoryId, mediaBucket, s3));
      if (method === 'GET' && segments[2] === 'ingestion' && segments.length === 3)
        return json(200, toIngestionResponse(await service.ingestion(coupleId, memoryId)));
      if (method === 'POST' && segments[2] === 'reindex' && segments.length === 3)
        return json(
          202,
          toIngestionResponse(
            await service.ingestion(coupleId, memoryId).then(async () => {
              await service.reindex(coupleId, memoryId);
              return service.ingestion(coupleId, memoryId);
            }),
          ),
        );
      if (method === 'PATCH' && segments.length === 2)
        return json(
          200,
          await service.update(
            coupleId,
            memoryId,
            updateMemoryRequestSchema.parse(parseBody(event.body)),
          ),
        );
      if (method === 'DELETE' && segments.length === 2) {
        await service.delete(coupleId, memoryId);
        return json(202, { accepted: true });
      }
      if (method === 'POST' && segments[2] === 'uploads') {
        const request = createUploadRequestSchema.parse(parseBody(event.body));
        const { photo } = await service.reservePhoto(coupleId, memoryId, request.contentType);
        if (photo.stagingKey === undefined) throw new Error('Upload key missing.');
        const post = await createPresignedPost(s3, {
          Bucket: mediaBucket,
          Key: photo.stagingKey,
          Expires: 300,
          Fields: { 'Content-Type': request.contentType },
          Conditions: [
            ['content-length-range', request.sizeBytes, request.sizeBytes],
            ['eq', '$Content-Type', request.contentType],
          ],
        });
        return json(201, {
          photoId: photo.photoId,
          ...post,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (method === 'DELETE' && segments[2] === 'photos' && segments[3] !== undefined) {
        await service.removePhoto(coupleId, memoryId, segments[3]);
        return json(202, { accepted: true });
      }
      throw new ResourceNotFoundError();
    } catch (caught: unknown) {
      const status =
        caught instanceof AuthorizationError
          ? 403
          : caught instanceof ResourceNotFoundError
            ? 404
            : caught instanceof ConflictError
              ? 409
              : caught instanceof DomainError || caught instanceof SyntaxError
                ? 400
                : 500;
      logger.log(status >= 500 ? 'error' : 'warn', 'memories.request.completed', {
        correlationId,
        statusCode: status,
      });
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
                  : 'INTERNAL_ERROR',
        message:
          status === 409
            ? 'This memory has changed. Reload it and try again.'
            : status === 404
              ? 'The requested resource was not found.'
              : status === 403
                ? 'You are not authorized to access this resource.'
                : status === 400
                  ? 'The request is invalid.'
                  : 'Unable to complete this request.',
        correlationId,
      };
      return json(status, error);
    }
  };
};

const toIngestionResponse = (state: {
  status: 'NOT_REQUESTED' | 'PENDING' | 'INDEXED' | 'FAILED';
  requestedAt?: string;
  indexedAt?: string;
  failureCode?: string;
}) => ({
  status: state.status,
  ...(state.requestedAt === undefined ? {} : { requestedAt: state.requestedAt }),
  ...(state.indexedAt === undefined ? {} : { indexedAt: state.indexedAt }),
  ...(state.failureCode === undefined ? {} : { failureCode: state.failureCode }),
  retryable: state.status === 'FAILED' || state.status === 'NOT_REQUESTED',
});

const withViewUrls = async (
  service: MemoryService,
  coupleId: string,
  memoryId: string,
  bucket: string,
  s3: S3Client,
) => {
  const memory = await service.get(coupleId, memoryId);
  return {
    ...memory,
    photos: await Promise.all(
      memory.photos.map(async (photo) => ({
        ...photo,
        ...(photo.displayKey === undefined
          ? {}
          : {
              displayUrl: await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucket, Key: photo.displayKey }),
                { expiresIn: 300 },
              ),
            }),
        ...(photo.thumbnailKey === undefined
          ? {}
          : {
              thumbnailUrl: await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucket, Key: photo.thumbnailKey }),
                { expiresIn: 300 },
              ),
            }),
      })),
    ),
  };
};

const tableName = process.env['APPLICATION_TABLE_NAME'];
const coupleId = process.env['COUPLE_ID'];
const mediaBucket = process.env['MEDIA_BUCKET_NAME'];
export const handler = async (event: Event): Promise<Response> => {
  if (tableName === undefined || coupleId === undefined || mediaBucket === undefined)
    throw new Error('Memory handler configuration is required.');
  return createMemoriesHandler(tableName, coupleId, mediaBucket)(event);
};
