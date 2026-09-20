import { describe, expect, it } from 'vitest';
import { createGetMeHandler } from './get-me.js';
import { GetMyProfile } from '../application/get-my-profile.js';
import type { MembershipRepository } from '../application/ports.js';

const repository: MembershipRepository = {
  findByUserId: async (_coupleId, userId) =>
    userId === 'subject-1'
      ? {
          userId,
          coupleId: 'couple-1',
          role: 'OWNER',
          displayName: 'Alex',
          status: 'ACTIVE',
        }
      : undefined,
};

const event = (claims: Record<string, unknown>) => ({
  requestContext: { requestId: 'request-1', authorizer: { jwt: { claims } } },
});

describe('GET /me handler', () => {
  it('returns the validated active member profile', async () => {
    const response = await createGetMeHandler(new GetMyProfile('couple-1', repository))(
      event({ sub: 'subject-1', 'cognito:groups': 'OWNER' }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ role: 'OWNER', userId: 'subject-1' });
  });

  it('does not disclose data when claims are malformed or membership is missing', async () => {
    const handler = createGetMeHandler(new GetMyProfile('couple-1', repository));
    await expect(
      handler(event({ sub: 'subject-1', 'cognito:groups': 'OWNER,PARTNER' })),
    ).resolves.toMatchObject({
      statusCode: 403,
    });
    await expect(
      handler(event({ sub: 'subject-2', 'cognito:groups': 'OWNER' })),
    ).resolves.toMatchObject({
      statusCode: 403,
    });
    await expect(handler(event({ 'cognito:groups': ['OWNER'] }))).resolves.toMatchObject({
      statusCode: 403,
    });
  });

  it('returns a safe service error when the membership repository fails', async () => {
    const failingRepository: MembershipRepository = {
      findByUserId: async () => Promise.reject(new Error('database details must not escape')),
    };
    const response = await createGetMeHandler(new GetMyProfile('couple-1', failingRepository))(
      event({ sub: 'subject-1', 'cognito:groups': ['OWNER'] }),
    );

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain('INTERNAL_ERROR');
    expect(response.body).not.toContain('database details');
  });
});
