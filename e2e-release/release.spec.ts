import { test, type Browser } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import {
  publicRuntimeConfigSchema,
  memberProfileSchema,
  memorySchema,
  timelineResponseSchema,
  ingestionStatusSchema,
  uploadInstructionsSchema,
  conversationSummarySchema,
  chatTurnSchema,
  groundedAnswerSchema,
  generatedCardDraftSchema,
  cardSchema,
  sendCardResponseSchema,
  inboxItemSchema,
  inboxListSchema,
  releaseReportSchema,
  releaseEvaluationDatasetSchema,
} from '@relationship-rag/contracts';
import { normalizeMemoryDocument } from '../services/memories/src/application/memory-document.js';
import { buildRetrievalFilter } from '../services/chat/src/adapters/bedrock-memory-retriever.js';
import { outputs, required, verifyAccount, aws } from '../scripts/release/io.mjs';
import { verifyBundle } from '../scripts/release/core.mjs';
import rawDataset from '../rag-evals/production-release.v1.json' with { type: 'json' };

const dataset = releaseEvaluationDatasetSchema.parse(rawDataset);

function ensure(value: unknown): asserts value {
  if (!value) throw new Error('LIVE_GATE_FAILED');
}
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until<T>(
  operation: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 600_000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await operation();
    if (ready(value)) return value;
    await pause(5000);
  }
  throw new Error('LIVE_POLL_TIMEOUT');
}
async function login(browser: Browser, base: string, role: string, denied = false) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByRole('button', { name: 'Sign in with your invitation' }).click();
  await page.locator('input[name="username"]').fill(required(`RELEASE_${role}_USERNAME`));
  await page.locator('input[name="password"]').fill(required(`RELEASE_${role}_PASSWORD`));
  const deniedResponse = denied
    ? page.waitForResponse(
        (response) => response.url().endsWith('/me') && response.status() === 403,
      )
    : undefined;
  await page.locator('button[type="submit"], input[type="submit"]').click();
  if (denied) {
    await deniedResponse;
    return { context, page, token: '' };
  } else await page.waitForURL(/\/app(?:\/|$)/);
  const token = await page.evaluate(
    () =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith('oidc.user:'))
        .map((key) => JSON.parse(sessionStorage.getItem(key) ?? '{}').access_token)
        .find(Boolean) as string | undefined,
  );
  ensure(token);
  return { context, page, token };
}

test('production candidate passes synthetic deployed acceptance and RAG gates', async ({
  browser,
}) => {
  const cases: { id: string; passed: boolean; durationMs: number }[] = [];
  let recallAt5 = 0,
    abstentionRate = 0,
    citationCorrectness = 0;
  let leakageCount = 0,
    forbiddenFactCount = 0;
  const started = new Date();
  const aiUsage: {
    service: 'chat' | 'cards';
    metric: 'ModelInputTokens' | 'ModelOutputTokens' | 'ModelLatency';
    maximum: number;
    sum: number;
  }[] = [];
  const step = async (id: string, run: () => Promise<void>) => {
    const time = Date.now();
    try {
      await run();
      cases.push({ id, passed: true, durationMs: Date.now() - time });
    } catch {
      cases.push({ id, passed: false, durationMs: Date.now() - time });
      throw new Error('LIVE_GATE_FAILED');
    }
  };
  try {
    ensure(required('RELEASE_STAGE') === 'test');
    verifyAccount();
    await verifyBundle(
      required('RELEASE_DIR'),
      required('RELEASE_DIGEST'),
      required('RELEASE_COMMIT'),
    );
    const base = `https://${outputs('test', 'edge')['DistributionDomainName']}`;
    const config = publicRuntimeConfigSchema.parse(
      await (await fetch(`${base}/assets/runtime-config.json`)).json(),
    );
    ensure(config.apiOrigin === outputs('test', 'api')['ApiEndpoint']);
    const data = outputs('test', 'data'),
      ai = outputs('test', 'ai');
    const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const s3 = new S3Client({});
    const sqs = new SQSClient({});
    const bedrock = new BedrockAgentRuntimeClient({ maxAttempts: 2 });
    const owner = await login(browser, base, 'OWNER'),
      partner = await login(browser, base, 'PARTNER');
    const api = async (
      token: string,
      path: string,
      method = 'GET',
      body?: unknown,
      status = 200,
    ) => {
      const result = await fetch(`${config.apiOrigin}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(28000),
      });
      ensure(result.status === status);
      if (status !== 401) ensure(result.headers.get('x-correlation-id'));
      return result.status === 204 ? undefined : await result.json();
    };
    const profile = memberProfileSchema.parse(await api(owner.token, '/me'));
    const recipient = memberProfileSchema.parse(await api(partner.token, '/me'));
    ensure(
      profile.role === 'OWNER' &&
        recipient.role === 'PARTNER' &&
        profile.coupleId === recipient.coupleId,
    );
    const decoy = {
      memoryId: randomUUID(),
      coupleId: `release-decoy-${randomUUID()}`,
      createdBy: 'synthetic',
      title: 'Our beach',
      body: 'We visited Cancun together. This belongs only to another couple.',
      occurredOn: '2025-05-01',
      locale: 'en' as const,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      photos: [],
      ingestionStatus: 'INDEXED' as const,
    };
    const sourceDocument = normalizeMemoryDocument(decoy);
    await dynamo.send(
      new PutCommand({
        TableName: data['ApplicationTableName'],
        Item: { PK: `COUPLE#${decoy.coupleId}`, SK: `MEMORY_ID#${decoy.memoryId}`, ...decoy },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    for (const [Key, Body] of [
      [sourceDocument.key, sourceDocument.body],
      [sourceDocument.metadataKey, sourceDocument.metadata],
    ] as const)
      await s3.send(new PutObjectCommand({ Bucket: data['RagSourceBucketName'], Key, Body }));
    await step('identity-isolation', async () => {
      await login(browser, base, 'OUTSIDER', true);
      await api('invalid', '/me', 'GET', undefined, 401);
      await api(owner.token, `/memories/${decoy.memoryId}`, 'GET', undefined, 404);
      await api(owner.token, `/memories/${decoy.memoryId}/ingestion`, 'GET', undefined, 404);
      const conversation = conversationSummarySchema.parse(
        await api(owner.token, '/conversations', 'POST', {}, 201),
      );
      await api(
        partner.token,
        `/conversations/${conversation.conversationId}`,
        'GET',
        undefined,
        404,
      );
    });
    const ids = new Map<string, string>();
    await step('memories-media', async () => {
      for (const fixture of dataset.memories) {
        const { key, ...request } = fixture;
        const memory = memorySchema.parse(
          await api(owner.token, '/memories', 'POST', request, 201),
        );
        ids.set(key, memory.memoryId);
      }
      const id = ids.get('anniversary')!;
      const memory = memorySchema.parse(await api(owner.token, `/memories/${id}`));
      await api(owner.token, `/memories/${id}`, 'PATCH', {
        ...dataset.memories[0],
        version: memory.version,
      });
      const sharp = (await import('sharp')).default;
      const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: { r: 120, g: 90, b: 150 } },
      })
        .png()
        .toBuffer();
      const upload = uploadInstructionsSchema.parse(
        await api(
          owner.token,
          `/memories/${id}/uploads`,
          'POST',
          { contentType: 'image/png', sizeBytes: png.length },
          201,
        ),
      );
      const form = new FormData();
      for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
      form.append('file', new Blob([png], { type: 'image/png' }), 'fixture.png');
      ensure((await fetch(upload.url, { method: 'POST', body: form })).ok);
      const ready = await until(
        async () => memorySchema.parse(await api(owner.token, `/memories/${id}`)),
        (item) => item.photos.some((photo) => photo.status === 'READY'),
      );
      const url = ready.photos.find((photo) => photo.status === 'READY')?.displayUrl;
      ensure(url);
      ensure((await fetch(url)).ok);
      const unsigned = new URL(url);
      unsigned.search = '';
      ensure((await fetch(unsigned)).status === 403);
      for (const memoryId of ids.values())
        await until(
          async () =>
            ingestionStatusSchema.parse(await api(owner.token, `/memories/${memoryId}/ingestion`)),
          (item) => item.status === 'INDEXED',
        );
      await api(owner.token, `/memories/${id}/reindex`, 'POST', {}, 202);
      await until(
        async () =>
          ingestionStatusSchema.parse(await api(owner.token, `/memories/${id}/ingestion`)),
        (item) => item.status === 'INDEXED',
      );
      const timeline = timelineResponseSchema.parse(await api(owner.token, '/timeline?limit=50'));
      ensure(
        timeline.items.every(
          (item, index) => index === 0 || timeline.items[index - 1]!.occurredOn >= item.occurredOn,
        ),
      );
      const disposable = memorySchema.parse(
        await api(owner.token, '/memories', 'POST', dataset.memories[0], 201),
      );
      await api(owner.token, `/memories/${disposable.memoryId}`, 'DELETE', undefined, 202);
      await api(owner.token, `/memories/${disposable.memoryId}`, 'GET', undefined, 404);
    });
    await step('retrieval', async () => {
      // Prove the decoy exists in the index, so isolation cannot pass vacuously.
      await until(
        async () =>
          bedrock.send(
            new RetrieveCommand({
              knowledgeBaseId: ai['KnowledgeBaseId'],
              retrievalQuery: { text: 'Which beach did we visit?' },
              retrievalConfiguration: {
                vectorSearchConfiguration: {
                  numberOfResults: 5,
                  filter: { equals: { key: 'coupleId', value: decoy.coupleId } },
                },
              },
            }),
          ),
        (response) =>
          !!response.retrievalResults?.some(
            (item) => item.metadata?.['memoryId'] === decoy.memoryId,
          ),
      );
      let found = 0,
        expected = 0;
      for (const item of dataset.cases.filter((item) => !item.abstention)) {
        const response = await bedrock.send(
          new RetrieveCommand({
            knowledgeBaseId: ai['KnowledgeBaseId'],
            retrievalQuery: { text: item.question },
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 5,
                filter: buildRetrievalFilter(profile.coupleId, item.filters),
              },
            },
          }),
        );
        const retrieved = response.retrievalResults ?? [];
        leakageCount += retrieved.filter(
          (item) => item.metadata?.['coupleId'] !== profile.coupleId,
        ).length;
        for (const key of item.expectedKeys) {
          expected++;
          if (retrieved.some((item) => item.metadata?.['memoryId'] === ids.get(key))) found++;
        }
      }
      recallAt5 = found / expected;
      ensure(recallAt5 >= dataset.minimumRecall && leakageCount === 0);
    });
    await step('chat-grounding', async () => {
      let unknown = 0,
        abstained = 0,
        citations = 0,
        correct = 0;
      for (const item of dataset.cases) {
        const conversation = conversationSummarySchema.parse(
          await api(owner.token, '/conversations', 'POST', {}, 201),
        );
        const turn = chatTurnSchema.parse(
          await api(owner.token, `/conversations/${conversation.conversationId}/messages`, 'POST', {
            requestId: randomUUID(),
            question: item.question,
            filters: item.filters,
          }),
        );
        ensure(turn.status === 'COMPLETED');
        const answer = groundedAnswerSchema.parse(turn);
        const text = answer.answer.toLowerCase();
        forbiddenFactCount += item.forbiddenFacts.filter((fact) =>
          text.includes(fact.toLowerCase()),
        ).length;
        if (item.abstention) {
          unknown++;
          if (answer.abstained && answer.citations.length === 0) abstained++;
        } else {
          ensure(
            !answer.abstained &&
              item.requiredFacts.every((fact) => text.includes(fact.toLowerCase())),
          );
          for (const citation of answer.citations) {
            citations++;
            if (item.expectedKeys.some((key) => ids.get(key) === citation.memoryId)) correct++;
            else leakageCount++;
          }
          ensure(
            item.expectedKeys.every((key) =>
              answer.citations.some((citation) => citation.memoryId === ids.get(key)),
            ),
          );
        }
        if (item.id === 'known-anniversary') {
          await owner.page.goto(`${base}/app/chat/${conversation.conversationId}`);
          await owner.page
            .locator(`a[href="/app/timeline/${ids.get('anniversary')}"]`)
            .first()
            .click();
          await owner.page.waitForURL(`**/app/timeline/${ids.get('anniversary')}`);

          const follow = chatTurnSchema.parse(
            await api(
              owner.token,
              `/conversations/${conversation.conversationId}/messages`,
              'POST',
              { requestId: randomUUID(), question: 'When was that?' },
            ),
          );
          ensure(
            follow.status === 'COMPLETED' &&
              !follow.abstained &&
              follow.answer?.includes('2024') &&
              follow.citations?.some((citation) => citation.memoryId === ids.get('anniversary')),
          );
        }
      }
      abstentionRate = abstained / unknown;
      citationCorrectness = correct / citations;
      ensure(
        abstentionRate >= 0.95 &&
          citationCorrectness === 1 &&
          forbiddenFactCount === 0 &&
          leakageCount === 0,
      );
    });
    await step('cards-delivery', async () => {
      await owner.page.goto(`${base}/app/cards/new`);
      await owner.page.getByLabel('Occasion').fill('Our anniversary');
      await owner.page.getByText('2024-06-12 · Our anniversary in Oaxaca', { exact: true }).click();
      await owner.page.getByRole('button', { name: 'Generate suggestion' }).click();
      await owner.page.getByRole('button', { name: 'Use this draft' }).click();
      await owner.page.getByLabel('Message').fill('I remember our anniversary in Oaxaca.');
      const savedResponse = owner.page.waitForResponse(
        (response) => response.url().endsWith('/cards') && response.request().method() === 'POST',
      );
      await owner.page.getByRole('button', { name: 'Save draft' }).click();
      const saved = cardSchema.parse(await (await savedResponse).json());
      await owner.page.getByRole('button', { name: 'Preview & send' }).click();
      await owner.page.getByRole('button', { name: 'Cancel', exact: true }).click();
      ensure(cardSchema.parse(await api(owner.token, `/cards/${saved.cardId}`)).status === 'DRAFT');
      await owner.page.getByRole('button', { name: 'Preview & send' }).click();
      await owner.page.getByRole('button', { name: 'Confirm send', exact: true }).click();
      await until(
        async () => inboxListSchema.parse(await api(partner.token, '/inbox?limit=50')),
        (items) => items.items.some((item) => item.cardId === saved.cardId),
      );

      const request = {
        recipientUserId: recipient.userId,
        occasion: 'Remember our anniversary in Oaxaca',
        tone: 'AFFECTIONATE',
        locale: 'en',
        memoryIds: [ids.get('anniversary')],
      };
      const draft = generatedCardDraftSchema.parse(
        await api(owner.token, '/cards/generate', 'POST', request),
      );
      ensure(
        draft.citedMemoryIds.length > 0 &&
          draft.citedMemoryIds.every((id) => id === ids.get('anniversary')),
      );
      ensure(!/paris|cancun/i.test(draft.body));
      const generic = generatedCardDraftSchema.parse(
        await api(owner.token, '/cards/generate', 'POST', {
          ...request,
          occasion: 'A kind thought',
          memoryIds: [],
        }),
      );
      ensure(generic.citedMemoryIds.length === 0);
      for (const scheduled of [false, true]) {
        let card = cardSchema.parse(
          await api(
            owner.token,
            '/cards',
            'POST',
            { ...request, ...draft, clientRequestId: randomUUID() },
            201,
          ),
        );
        await api(partner.token, `/cards/${card.cardId}`, 'GET', undefined, 404);
        card = cardSchema.parse(
          await api(owner.token, `/cards/${card.cardId}`, 'PATCH', {
            ...request,
            ...draft,
            body: `${draft.body}\nThinking of you.`,
            version: card.version,
          }),
        );
        await api(
          owner.token,
          `/cards/${card.cardId}/send`,
          'POST',
          { confirmed: false, version: card.version, idempotencyKey: randomUUID() },
          400,
        );
        ensure(
          cardSchema.parse(await api(owner.token, `/cards/${card.cardId}`)).status === 'DRAFT',
        );
        const deliveryAt = new Date(Date.now() + 120000).toISOString();
        const send = {
          confirmed: true,
          version: card.version,
          idempotencyKey: randomUUID(),
          ...(scheduled ? { deliveryAt } : {}),
        };
        const delivery = sendCardResponseSchema.parse(
          await api(owner.token, `/cards/${card.cardId}/send`, 'POST', send, 202),
        );
        const again = sendCardResponseSchema.parse(
          await api(owner.token, `/cards/${card.cardId}/send`, 'POST', send, 202),
        );
        ensure(delivery.deliveryId === again.deliveryId);
        if (scheduled) await api(partner.token, `/inbox/${card.cardId}`, 'GET', undefined, 404);
        // An early scheduled duplicate must fail/retry and cannot bypass the due time.
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: outputs('test', 'messaging')['DeliveryQueueUrl'],
            MessageBody: JSON.stringify({
              coupleId: profile.coupleId,
              deliveryId: delivery.deliveryId,
            }),
          }),
        );
        const inbox = await until(
          async () => inboxListSchema.parse(await api(partner.token, '/inbox?limit=50')),
          (items) => items.items.some((item) => item.cardId === card.cardId),
        );
        const received = inbox.items.find((item) => item.cardId === card.cardId)!;
        ensure(Date.parse(received.deliveredAt) >= Date.parse(delivery.deliveryAt));
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: outputs('test', 'messaging')['DeliveryQueueUrl'],
            MessageBody: JSON.stringify({
              coupleId: profile.coupleId,
              deliveryId: delivery.deliveryId,
            }),
          }),
        );
        await pause(10000);
        ensure(
          inboxListSchema
            .parse(await api(partner.token, '/inbox?limit=50'))
            .items.filter((item) => item.cardId === card.cardId).length === 1,
        );
        await api(owner.token, `/inbox/${card.cardId}`, 'GET', undefined, 404);
        ensure(
          inboxItemSchema.parse(await api(partner.token, `/inbox/${card.cardId}/read`, 'POST', {}))
            .readAt,
        );
      }
    });
    await step('accessibility', async () => {
      for (const session of [owner, partner])
        for (const width of [320, 1280]) {
          await session.page.setViewportSize({ width, height: 900 });
          for (const route of [
            '/app/timeline',
            '/app/timeline/new',
            '/app/chat',
            '/app/cards',
            '/app/cards/new',
            '/app/inbox',
          ]) {
            await session.page.goto(`${base}${route}`);
            await session.page.getByRole('navigation', { name: 'Primary navigation' }).waitFor();
            const result = await new AxeBuilder({ page: session.page }).analyze();
            ensure(
              !result.violations.some(
                (item) => item.impact === 'critical' || item.impact === 'serious',
              ),
            );
            await session.page.keyboard.press('Tab');
            ensure(await session.page.evaluate(() => document.activeElement !== document.body));
          }
        }
    });
    await step('ai-budgets', async () => {
      for (const service of ['chat', 'cards'] as const)
        for (const metric of ['ModelInputTokens', 'ModelOutputTokens', 'ModelLatency'] as const) {
          const result = await until(
            async () =>
              aws([
                'cloudwatch',
                'get-metric-statistics',
                '--namespace',
                'RelationshipRag',
                '--metric-name',
                metric,
                '--dimensions',
                'Name=Stage,Value=test',
                `Name=Service,Value=${service}`,
                '--start-time',
                started.toISOString(),
                '--end-time',
                new Date().toISOString(),
                '--period',
                '60',
                '--statistics',
                'Maximum',
                'Sum',
              ]),
            (result) => result.Datapoints?.length > 0,
            180000,
          );
          aiUsage.push({
            service,
            metric,
            maximum: Math.max(
              ...result.Datapoints.map((point: { Maximum: number }) => point.Maximum),
            ),
            sum: result.Datapoints.reduce(
              (total: number, point: { Sum: number }) => total + point.Sum,
              0,
            ),
          });
          if (metric === 'ModelOutputTokens')
            ensure(
              result.Datapoints.every(
                (point: { Maximum: number }) => point.Maximum <= (service === 'chat' ? 1024 : 1200),
              ),
            );
          if (metric === 'ModelLatency')
            ensure(result.Datapoints.every((point: { Maximum: number }) => point.Maximum <= 24000));
        }
    });
  } catch {
    throw new Error(
      'Release live acceptance failed; inspect the sanitized case report and private operator diagnostics.',
    );
  } finally {
    await mkdir('release-evidence', { recursive: true });
    const report = releaseReportSchema.parse({
      version: 1,
      commit: required('RELEASE_COMMIT'),
      bundleDigest: required('RELEASE_DIGEST'),
      cases: cases.length ? cases : [{ id: 'setup', passed: false, durationMs: 0 }],
      recallAt5,
      abstentionRate,
      citationCorrectness,
      leakageCount,
      forbiddenFactCount,
      aiUsage,
    });
    await writeFile('release-evidence/live-report.json', JSON.stringify(report, null, 2));
  }
});
