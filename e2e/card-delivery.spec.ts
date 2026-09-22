import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const now = '2026-09-21T12:00:00.000Z';
const memoryId = '11111111-1111-4111-8111-111111111111';
const cardId = '22222222-2222-4222-8222-222222222222';

const authenticate = async (page: Page) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'oidc.user:http://127.0.0.1:4200/mock-oidc:e2e-client',
      JSON.stringify({
        access_token: 'synthetic-token',
        token_type: 'Bearer',
        scope: 'openid profile email relationship-rag/access',
        profile: { sub: 'sender' },
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
  });
};

for (const deliveryMode of ['immediate', 'scheduled'] as const)
  test(`${deliveryMode} card creation and inbox journey`, async ({ page }) => {
    let card: Record<string, unknown> | undefined;
    let inbox: Record<string, unknown> | undefined;
    await authenticate(page);
    await page.route('**/assets/runtime-config.json', (route) =>
      route.fulfill({
        json: {
          apiOrigin: 'http://127.0.0.1:4200/mock-api',
          authority: 'http://127.0.0.1:4200/mock-oidc',
          clientId: 'e2e-client',
          scope: 'openid profile email relationship-rag/access',
        },
      }),
    );
    await page.route('**/mock-api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace('/mock-api', '');
      const body = request.postDataJSON?.() as Record<string, unknown> | null;
      if (path === '/me')
        return route.fulfill({
          json: { userId: 'sender', coupleId: 'couple', role: 'OWNER', displayName: 'Alex' },
        });
      if (path === '/cards/recipients')
        return route.fulfill({ json: { items: [{ userId: 'partner', displayName: 'Sam' }] } });
      if (path === '/timeline')
        return route.fulfill({
          json: {
            items: [
              {
                memoryId,
                coupleId: 'couple',
                createdBy: 'sender',
                title: 'Beach day',
                occurredOn: '2025-05-01',
                body: 'We spent the day at the beach.',
                locale: 'en',
                tags: [],
                ingestionStatus: 'INDEXED',
                version: 1,
                photos: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        });
      if (path === '/cards/generate')
        return route.fulfill({
          json: {
            title: 'Our beach day',
            body: 'I still smile about our beach day.',
            citedMemoryIds: [memoryId],
          },
        });
      if (path === '/cards' && request.method() === 'POST') {
        card = {
          cardId,
          senderUserId: 'sender',
          recipientUserId: 'partner',
          recipientDisplayName: 'Sam',
          occasion: body?.['occasion'],
          tone: body?.['tone'],
          locale: body?.['locale'],
          memoryIds: body?.['memoryIds'],
          citedMemoryIds: body?.['citedMemoryIds'],
          title: body?.['title'],
          body: body?.['body'],
          status: 'DRAFT',
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        return route.fulfill({ status: 201, json: card });
      }
      if (path === `/cards/${cardId}/send`) {
        const deliveryAt = typeof body?.['deliveryAt'] === 'string' ? body['deliveryAt'] : now;
        const status = deliveryMode === 'scheduled' ? 'SCHEDULED' : 'QUEUED';
        card = { ...card, status, version: 2, deliveryAt };
        inbox = {
          cardId,
          deliveryId: '33333333-3333-4333-8333-333333333333',
          senderUserId: 'sender',
          senderDisplayName: 'Alex',
          recipientUserId: 'partner',
          occasion: card['occasion'],
          tone: card['tone'],
          locale: card['locale'],
          title: card['title'],
          body: card['body'],
          citedMemoryIds: card['citedMemoryIds'],
          deliveredAt: now,
        };
        return route.fulfill({
          status: 202,
          json: { deliveryId: inbox.deliveryId, cardId, status, deliveryAt },
        });
      }
      if (path === `/cards/${cardId}`) return route.fulfill({ json: card });
      if (path === '/inbox')
        return route.fulfill({ json: { items: inbox === undefined ? [] : [inbox] } });
      if (path === `/inbox/${cardId}/read`) {
        inbox = { ...inbox, readAt: now };
        return route.fulfill({ json: inbox });
      }
      if (path === `/inbox/${cardId}`) return route.fulfill({ json: inbox });
      return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found' } });
    });

    await page.goto('/app/cards/new');
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      ),
    ).toEqual([]);
    await page.getByLabel('Occasion').fill('Anniversary');
    await page.getByText('2025-05-01 · Beach day').click();
    await page.getByRole('button', { name: 'Generate suggestion' }).click();
    await expect(page.getByText('New suggestion')).toBeVisible();
    await page.getByLabel('Message').fill('Keep this edit while I consider another suggestion.');
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByLabel('Message')).toHaveValue(
      'Keep this edit while I consider another suggestion.',
    );
    await page.getByRole('button', { name: 'Generate suggestion' }).click();
    await page.getByRole('button', { name: 'Use this draft' }).click();
    await page.getByLabel('Message').fill('I still smile about our wonderful beach day.');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.getByRole('button', { name: 'Preview & send' }).click();
    await expect(page.getByRole('heading', { name: 'Confirm delivery' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    if (deliveryMode === 'scheduled')
      await page.getByLabel('Schedule for later (optional)').fill('2026-09-22T12:00');
    await page.getByRole('button', { name: 'Confirm send' }).click();
    await page.goto('/app/inbox');
    await expect(page.getByText('Our beach day')).toBeVisible();
    await page.getByText('Our beach day').click();
    await expect(page.getByText('I still smile about our wonderful beach day.')).toBeVisible();
  });
