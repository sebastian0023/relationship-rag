import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {
  request as playwrightRequest,
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from '@playwright/test';
import {
  loadManifest,
  newManifest,
  recordFixture,
  saveManifest,
} from '../scripts/live-fixtures.mjs';
import { runLiveAiEvaluation } from './live-ai-evaluation.js';

type Json = Record<string, unknown>;
const baseURL = process.env['PHASE7_BASE_URL'];
const ownerCredentials = [process.env['LIVE_OWNER_USERNAME'], process.env['LIVE_OWNER_PASSWORD']];
const partnerCredentials = [
  process.env['LIVE_PARTNER_USERNAME'],
  process.env['LIVE_PARTNER_PASSWORD'],
];
if (!baseURL || [...ownerCredentials, ...partnerCredentials].some((value) => !value))
  throw new Error('The test-stage URL and two invited test-stage logins are required.');

const awsJson = (args: string[]) =>
  JSON.parse(
    execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json'], {
      encoding: 'utf8',
    }),
  ) as Json;

const stackOutput = (stackName: string, key: string) => {
  const stack = (
    awsJson(['cloudformation', 'describe-stacks', '--stack-name', stackName])['Stacks'] as
      Json[] | undefined
  )?.[0];
  if (
    !stack ||
    (stack['StackStatus'] !== 'UPDATE_COMPLETE' && stack['StackStatus'] !== 'CREATE_COMPLETE')
  )
    throw new Error(`The ${stackName} deployment is not ready.`);
  if (
    !(stack['Tags'] as Json[] | undefined)?.some(
      (tag) => tag['Key'] === 'Environment' && tag['Value'] === 'test',
    )
  )
    throw new Error(`The ${stackName} deployment is not tagged test.`);
  const output = (stack['Outputs'] as Json[] | undefined)?.find(
    (item) => item['OutputKey'] === key,
  )?.['OutputValue'];
  if (!output) throw new Error(`The ${stackName} output ${key} is missing.`);
  return String(output);
};

const login = async (browser: Browser, credentials: (string | undefined)[]) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`);
  await page.getByRole('button', { name: 'Sign in with your invitation' }).click();
  await page.locator('input[name="username"]:visible').first().fill(credentials[0]!);
  await page.locator('input[name="password"]:visible').first().fill(credentials[1]!);
  await page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first().click();
  await page.waitForURL(/\/app(?:\/|$)/);
  const token = await page.evaluate(() => {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith('oidc.user:')) continue;
      const user = JSON.parse(sessionStorage.getItem(key) ?? '{}') as { access_token?: string };
      if (user.access_token) return user.access_token;
    }
    return null;
  });
  if (!token) throw new Error('Managed login did not yield an access token.');
  return { context, page, token };
};

const waitFor = async (check: () => Promise<boolean>, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('An asynchronous test-stage operation did not complete before its deadline.');
};

const cleanup = async (path: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/cleanup-live-fixtures.mjs', path, '--confirm'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (part: Buffer) => {
      output += part.toString();
    });
    child.stderr.on('data', (part: Buffer) => {
      output += part.toString();
    });
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Fixture cleanup failed; review ${path}. ${output.slice(0, 500)}`)),
    );
  });

test('both members complete the real memory, chat, card, delivery, and inbox journey', async ({
  browser,
  request,
}) => {
  test.setTimeout(25 * 60_000);
  const region = 'us-east-1';
  const accountId = String(awsJson(['sts', 'get-caller-identity'])['Account'] ?? '');
  if (!accountId || accountId !== process.env['AWS_ACCOUNT_ID'])
    throw new Error('AWS account does not match the expected test account.');
  const [tableName, mediaBucket, sourceBucket, deployedApi, knowledgeBaseId] = await Promise.all([
    stackOutput('relationship-rag-test-data', 'ApplicationTableName'),
    stackOutput('relationship-rag-test-data', 'MediaBucketName'),
    stackOutput('relationship-rag-test-data', 'RagSourceBucketName'),
    stackOutput('relationship-rag-test-api', 'ApiEndpoint'),
    stackOutput('relationship-rag-test-ai', 'KnowledgeBaseId'),
  ]);
  const runtimeConfig = (await (
    await request.get(`${baseURL}/assets/runtime-config.json`)
  ).json()) as Json;
  if (runtimeConfig['apiOrigin'] !== deployedApi)
    throw new Error('Frontend points at a different API deployment.');
  const apiOrigin = deployedApi;
  const owner = await login(browser, ownerCredentials);
  const partner = await login(browser, partnerCredentials);
  const ownerApi = await playwrightRequest.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${owner.token}` },
  });
  const partnerApi = await playwrightRequest.newContext({
    extraHTTPHeaders: { authorization: `Bearer ${partner.token}` },
  });
  const api = async (client: APIRequestContext, method: string, path: string, data?: Json) => {
    const response = await client.fetch(`${apiOrigin}${path}`, {
      method,
      ...(data ? { data } : {}),
    });
    return {
      status: response.status(),
      body: response.status() === 204 ? {} : ((await response.json()) as Json),
      correlation: response.headers()['x-correlation-id'],
    };
  };
  const manifest = newManifest({
    accountId,
    coupleId: 'relationship-rag-test',
    region,
    tableName,
    mediaBucket,
    sourceBucket,
  });
  const manifestPath = join('.verification-runs', `${manifest.runId}.json`);
  await saveManifest(manifestPath, manifest);
  const createdMemories: string[] = [];
  try {
    const ownerProfile = await api(ownerApi, 'GET', '/me');
    const partnerProfile = await api(partnerApi, 'GET', '/me');
    expect(ownerProfile.status).toBe(200);
    expect(partnerProfile.status).toBe(200);
    expect(ownerProfile.body['coupleId']).toBe('relationship-rag-test');
    expect(partnerProfile.body['coupleId']).toBe('relationship-rag-test');
    expect(ownerProfile.body['userId']).not.toBe(partnerProfile.body['userId']);
    expect((await request.get(`${apiOrigin}/me`)).status()).toBe(401);
    const ownerId = String(ownerProfile.body['userId']);
    const partnerId = String(partnerProfile.body['userId']);
    const fixtures = [
      {
        client: ownerApi,
        ownerId,
        title: `${manifest.tag} Oaxaca`,
        occurredOn: '2025-04-10',
        body: `On our synthetic anniversary we celebrated in Oaxaca. ${manifest.tag}`,
        locale: 'en',
        category: 'TRAVEL',
      },
      {
        client: partnerApi,
        ownerId: partnerId,
        title: `${manifest.tag} cena`,
        occurredOn: '2025-05-10',
        body: `Cocinamos mole en nuestra cena sintética. ${manifest.tag}`,
        locale: 'es',
        category: 'FOOD',
      },
    ];
    for (const fixture of fixtures) {
      const created = await api(fixture.client, 'POST', '/memories', {
        title: fixture.title,
        occurredOn: fixture.occurredOn,
        body: fixture.body,
        locale: fixture.locale,
        category: fixture.category,
        tags: [manifest.tag],
        location: 'Synthetic place',
      });
      expect(created.status).toBe(201);
      expect(created.correlation).toBeTruthy();
      const memoryId = String(created.body['memoryId']);
      await recordFixture(manifestPath, {
        kind: 'memory',
        id: memoryId,
        occurredOn: fixture.occurredOn,
      });
      createdMemories.push(memoryId);
      const read = await api(partnerApi, 'GET', `/memories/${memoryId}`);
      expect(read.body['category']).toBe(fixture.category);
      expect(read.body['tags']).toContain(manifest.tag);
      const stale = await api(fixture.client, 'PATCH', `/memories/${memoryId}`, {
        title: fixture.title,
        occurredOn: fixture.occurredOn,
        body: fixture.body,
        locale: fixture.locale,
        category: fixture.category,
        tags: [manifest.tag],
        version: 999,
      });
      expect(stale.status).toBe(409);
    }
    const timeline = await api(ownerApi, 'GET', '/timeline?limit=50');
    expect(timeline.status).toBe(200);
    for (const memoryId of createdMemories)
      expect((timeline.body['items'] as Json[]).some((item) => item['memoryId'] === memoryId)).toBe(
        true,
      );
    for (const memoryId of createdMemories)
      await waitFor(
        async () =>
          (await api(ownerApi, 'GET', `/memories/${memoryId}/ingestion`)).body['status'] ===
          'INDEXED',
        180_000,
      );

    const photoBytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 70, g: 120, b: 180 } },
    })
      .png()
      .toBuffer();
    const upload = await api(ownerApi, 'POST', `/memories/${createdMemories[0]}/uploads`, {
      contentType: 'image/png',
      sizeBytes: photoBytes.byteLength,
    });
    expect(upload.status).toBe(201);
    const uploadResponse = await request.post(String(upload.body['url']), {
      multipart: {
        ...(upload.body['fields'] as Record<string, string>),
        file: { name: 'synthetic.png', mimeType: 'image/png', buffer: photoBytes },
      },
    });
    expect(uploadResponse.ok()).toBe(true);
    const photoId = String(upload.body['photoId']);
    await waitFor(async () => {
      const detail = await api(ownerApi, 'GET', `/memories/${createdMemories[0]}`);
      return (detail.body['photos'] as Json[]).some(
        (photo) => photo['photoId'] === photoId && photo['status'] === 'READY',
      );
    }, 120_000);
    const photoDetail = await api(ownerApi, 'GET', `/memories/${createdMemories[0]}`);
    const photo = (photoDetail.body['photos'] as Json[]).find(
      (item) => item['photoId'] === photoId,
    )!;
    expect((await request.get(String(photo['displayUrl']))).status()).toBe(200);
    expect(
      (await api(ownerApi, 'DELETE', `/memories/${createdMemories[0]}/photos/${photoId}`)).status,
    ).toBe(202);

    const conversation = await api(ownerApi, 'POST', '/conversations');
    expect(conversation.status).toBe(201);
    const conversationId = String(conversation.body['conversationId']);
    await recordFixture(manifestPath, {
      kind: 'conversation',
      id: conversationId,
      ownerId,
      createdAt: conversation.body['createdAt'],
    });
    const known = await api(ownerApi, 'POST', `/conversations/${conversationId}/messages`, {
      requestId: randomUUID(),
      question: `Where was the synthetic anniversary ${manifest.tag}?`,
      filters: { tags: [manifest.tag] },
    });
    expect(known.status).toBe(201);
    expect(
      (known.body['citations'] as Json[]).some(
        (citation) => citation['memoryId'] === createdMemories[0],
      ),
    ).toBe(true);
    const unknown = await api(ownerApi, 'POST', `/conversations/${conversationId}/messages`, {
      requestId: randomUUID(),
      question: `What was the synthetic dog's name ${manifest.tag}?`,
      filters: { tags: [manifest.tag] },
    });
    expect(unknown.status).toBe(201);
    expect(unknown.body['abstained']).toBe(true);
    expect(unknown.body['citations']).toEqual([]);
    expect((await api(partnerApi, 'GET', `/conversations/${conversationId}`)).status).toBe(404);

    await runLiveAiEvaluation({
      tag: manifest.tag,
      coupleId: manifest.coupleId,
      ownerId,
      knowledgeBaseId,
      memoryIds: createdMemories,
      api: (method, path, data) => api(ownerApi, method, path, data),
      recordConversation: async (id, createdAt) => {
        await recordFixture(manifestPath, { kind: 'conversation', id, ownerId, createdAt });
      },
    });

    const recipients = await api(ownerApi, 'GET', '/cards/recipients');
    expect((recipients.body['items'] as Json[]).some((item) => item['userId'] === partnerId)).toBe(
      true,
    );
    const suggestion = await api(ownerApi, 'POST', '/cards/generate', {
      recipientUserId: partnerId,
      occasion: `${manifest.tag} anniversary`,
      tone: 'AFFECTIONATE',
      locale: 'en',
      memoryIds: [createdMemories[0]],
    });
    expect(suggestion.status).toBe(200);
    expect(suggestion.body['citedMemoryIds']).toContain(createdMemories[0]);
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const generic = await api(ownerApi, 'POST', '/cards/generate', {
      recipientUserId: partnerId,
      occasion: `${manifest.tag} generic`,
      tone: 'PLAYFUL',
      locale: 'en',
      memoryIds: [],
    });
    expect(generic.status).toBe(200);
    expect(generic.body['citedMemoryIds']).toEqual([]);
    expect(String(generic.body['body'])).not.toMatch(/Oaxaca|mole/i);
    const saveRequestId = randomUUID();
    const card = await api(ownerApi, 'POST', '/cards', {
      clientRequestId: saveRequestId,
      recipientUserId: partnerId,
      occasion: `${manifest.tag} anniversary`,
      tone: 'AFFECTIONATE',
      locale: 'en',
      memoryIds: [createdMemories[0]],
      citedMemoryIds: suggestion.body['citedMemoryIds'],
      title: suggestion.body['title'],
      body: suggestion.body['body'],
    });
    expect(card.status).toBe(201);
    const cardId = String(card.body['cardId']);
    await recordFixture(manifestPath, {
      kind: 'card',
      id: cardId,
      ownerId,
      createdAt: card.body['createdAt'],
      requestId: saveRequestId,
    });
    expect((await api(partnerApi, 'GET', `/cards/${cardId}`)).status).toBe(404);
    expect((await api(partnerApi, 'GET', `/inbox/${cardId}`)).status).toBe(404);
    expect(
      (
        await api(ownerApi, 'POST', `/cards/${cardId}/send`, {
          confirmed: false,
          version: card.body['version'],
          idempotencyKey: `${manifest.tag}-${randomUUID()}`,
        })
      ).status,
    ).toBe(400);
    const idempotencyKey = `${manifest.tag}-${randomUUID()}`;
    const sent = await api(ownerApi, 'POST', `/cards/${cardId}/send`, {
      confirmed: true,
      version: card.body['version'],
      idempotencyKey,
    });
    expect(sent.status).toBe(202);
    const deliveryId = String(sent.body['deliveryId']);
    await recordFixture(manifestPath, {
      kind: 'delivery',
      id: deliveryId,
      ownerId,
      recipientId: partnerId,
      cardId,
      createdAt: card.body['createdAt'],
      idempotencyKey,
    });
    const replay = await api(ownerApi, 'POST', `/cards/${cardId}/send`, {
      confirmed: true,
      version: card.body['version'],
      idempotencyKey,
    });
    expect(replay.body['deliveryId']).toBe(deliveryId);
    expect(
      (
        await api(ownerApi, 'POST', `/cards/${cardId}/send`, {
          confirmed: true,
          version: 999,
          idempotencyKey,
        })
      ).status,
    ).toBe(409);
    expect(
      (await api(ownerApi, 'DELETE', `/cards/${cardId}?version=${card.body['version']}`)).status,
    ).toBe(409);
    await waitFor(
      async () => (await api(partnerApi, 'GET', `/inbox/${cardId}`)).status === 200,
      120_000,
    );
    const inbox = await api(partnerApi, 'GET', `/inbox/${cardId}`);
    expect(inbox.body['deliveryId']).toBe(deliveryId);
    expect(inbox.body['body']).toBe(suggestion.body['body']);
    expect((await api(partnerApi, 'PATCH', `/inbox/${cardId}/read`)).status).toBe(200);
    expect((await api(ownerApi, 'GET', `/inbox/${cardId}`)).status).toBe(404);
    await partner.page.goto(`${baseURL}/app/inbox/${cardId}`);
    await expect(partner.page.getByText(String(card.body['title']))).toBeVisible();

    const scheduledRequestId = randomUUID();
    const scheduledCard = await api(partnerApi, 'POST', '/cards', {
      clientRequestId: scheduledRequestId,
      recipientUserId: ownerId,
      occasion: `${manifest.tag} scheduled`,
      tone: 'GRATEFUL',
      locale: 'es',
      memoryIds: [createdMemories[1]],
      citedMemoryIds: [createdMemories[1]],
      title: `${manifest.tag} tarjeta`,
      body: `Gracias por el mole sintético. ${manifest.tag}`,
    });
    expect(scheduledCard.status).toBe(201);
    const scheduledCardId = String(scheduledCard.body['cardId']);
    await recordFixture(manifestPath, {
      kind: 'card',
      id: scheduledCardId,
      ownerId: partnerId,
      createdAt: scheduledCard.body['createdAt'],
      requestId: scheduledRequestId,
    });
    const scheduledKey = `${manifest.tag}-${randomUUID()}`;
    const dueAt = new Date(Date.now() + 90_000).toISOString();
    const scheduled = await api(partnerApi, 'POST', `/cards/${scheduledCardId}/send`, {
      confirmed: true,
      version: scheduledCard.body['version'],
      idempotencyKey: scheduledKey,
      deliveryAt: dueAt,
    });
    expect(scheduled.status).toBe(202);
    expect(scheduled.body['status']).toBe('SCHEDULED');
    await recordFixture(manifestPath, {
      kind: 'delivery',
      id: String(scheduled.body['deliveryId']),
      ownerId: partnerId,
      recipientId: ownerId,
      cardId: scheduledCardId,
      createdAt: scheduledCard.body['createdAt'],
      idempotencyKey: scheduledKey,
    });
    expect((await api(ownerApi, 'GET', `/inbox/${scheduledCardId}`)).status).toBe(404);
    await waitFor(
      async () => (await api(ownerApi, 'GET', `/inbox/${scheduledCardId}`)).status === 200,
      240_000,
    );
    const draftRequestId = randomUUID();
    const draft = await api(ownerApi, 'POST', '/cards', {
      clientRequestId: draftRequestId,
      recipientUserId: partnerId,
      occasion: `${manifest.tag} editable`,
      tone: 'REFLECTIVE',
      locale: 'en',
      memoryIds: [],
      citedMemoryIds: [],
      title: `${manifest.tag} draft`,
      body: 'Synthetic draft.',
    });
    expect(draft.status).toBe(201);
    const draftId = String(draft.body['cardId']);
    await recordFixture(manifestPath, {
      kind: 'card',
      id: draftId,
      ownerId,
      createdAt: draft.body['createdAt'],
      requestId: draftRequestId,
    });
    const editedRequest = {
      version: draft.body['version'],
      recipientUserId: partnerId,
      occasion: `${manifest.tag} editable`,
      tone: 'REFLECTIVE',
      locale: 'en',
      memoryIds: [],
      citedMemoryIds: [],
      title: `${manifest.tag} edited`,
      body: 'Edited synthetic draft.',
    };
    const updated = await api(ownerApi, 'PATCH', `/cards/${draftId}`, editedRequest);
    expect(updated.status).toBe(200);
    expect((await api(ownerApi, 'PATCH', `/cards/${draftId}`, editedRequest)).status).toBe(409);
    expect(
      (await api(ownerApi, 'DELETE', `/cards/${draftId}?version=${updated.body['version']}`))
        .status,
    ).toBe(204);
  } finally {
    try {
      const table = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
      const s3 = new S3Client({ region });
      const finalManifest = await loadManifest(manifestPath);
      for (const delivery of finalManifest.fixtures.filter((item) => item['kind'] === 'delivery')) {
        await waitFor(async () => {
          const result = await table.send(
            new GetCommand({
              TableName: tableName,
              Key: { PK: `COUPLE#${manifest.coupleId}`, SK: `DELIVERY#${delivery['id']}` },
              ConsistentRead: true,
            }),
          );
          return (
            result.Item !== undefined &&
            ['DELIVERED', 'FAILED'].includes(String(result.Item['status']))
          );
        }, 300_000);
      }
      for (const memoryId of createdMemories)
        await api(ownerApi, 'DELETE', `/memories/${memoryId}`);
      for (const memoryId of createdMemories) {
        await waitFor(async () => {
          const canonical = await table.send(
            new GetCommand({
              TableName: tableName,
              Key: { PK: `COUPLE#${manifest.coupleId}`, SK: `MEMORY_ID#${memoryId}` },
              ConsistentRead: true,
            }),
          );
          const work = await table.send(
            new GetCommand({
              TableName: tableName,
              Key: { PK: `COUPLE#${manifest.coupleId}`, SK: `INGESTION_WORK#${memoryId}` },
              ConsistentRead: true,
            }),
          );
          let sourceExists = true;
          try {
            await s3.send(
              new HeadObjectCommand({
                Bucket: sourceBucket,
                Key: `memories/${manifest.coupleId}/${memoryId}.md`,
              }),
            );
          } catch (error) {
            if (
              (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ===
              404
            )
              sourceExists = false;
            else throw error;
          }
          return !canonical.Item && !work.Item && !sourceExists;
        }, 180_000);
      }
      await cleanup(manifestPath);
    } finally {
      await owner.context.close();
      await partner.context.close();
      await ownerApi.dispose();
      await partnerApi.dispose();
    }
  }
});
