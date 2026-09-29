import { expect, test, type Page } from '@playwright/test';
import {
  authenticate,
  expectAccessible,
  expectNoHorizontalOverflow,
  now,
  profile,
} from './support';

const memoryId = '11111111-1111-4111-8111-111111111111';
const cardId = '22222222-2222-4222-8222-222222222222';
const deliveryId = '33333333-3333-4333-8333-333333333333';

const beachDay = {
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
};

interface CardsMock {
  card: Record<string, unknown> | undefined;
  inbox: Record<string, unknown> | undefined;
  requests: { method: string; path: string; body: Record<string, unknown> | null }[];
  /** How many GETs of a queued card happen before it reports SENT. */
  pollsUntilSent: number;
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  cardId,
  senderUserId: 'sender',
  recipientUserId: 'partner',
  recipientDisplayName: 'Sam',
  occasion: 'Anniversary',
  tone: 'AFFECTIONATE',
  locale: 'en',
  memoryIds: [memoryId],
  citedMemoryIds: [memoryId],
  title: 'Our beach day',
  body: 'I still smile about our beach day.',
  status: 'DRAFT',
  version: 1,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const mockCards = async (page: Page, initial?: Record<string, unknown>): Promise<CardsMock> => {
  const mock: CardsMock = { card: initial, inbox: undefined, requests: [], pollsUntilSent: 1 };
  await authenticate(page);
  await page.route('**/mock-api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/mock-api', '');
    const body = request.postDataJSON?.() as Record<string, unknown> | null;
    mock.requests.push({ method: request.method(), path, body });
    if (path === '/me') return route.fulfill({ json: profile });
    if (path === '/cards/recipients')
      return route.fulfill({ json: { items: [{ userId: 'partner', displayName: 'Sam' }] } });
    if (path === '/timeline') return route.fulfill({ json: { items: [beachDay] } });
    if (path === `/memories/${memoryId}`) return route.fulfill({ json: beachDay });
    if (path === '/cards/generate')
      return route.fulfill({
        json: {
          title: 'Our beach day',
          body: 'I still smile about our beach day.',
          citedMemoryIds: [memoryId],
        },
      });
    if (path === '/cards' && request.method() === 'POST') {
      mock.card = draft({ ...body, status: 'DRAFT', version: 1 });
      return route.fulfill({ status: 201, json: mock.card });
    }
    if (path === '/cards')
      return route.fulfill({ json: { items: mock.card === undefined ? [] : [mock.card] } });
    if (path === `/cards/${cardId}` && request.method() === 'PATCH') {
      mock.card = { ...mock.card, ...body, version: Number(body?.['version']) + 1 };
      return route.fulfill({ json: mock.card });
    }
    if (path === `/cards/${cardId}/send`) {
      const deliveryAt = typeof body?.['deliveryAt'] === 'string' ? body['deliveryAt'] : now;
      const status = body?.['deliveryAt'] === undefined ? 'QUEUED' : 'SCHEDULED';
      mock.card = { ...mock.card, status, version: 2, deliveryAt };
      mock.inbox = {
        cardId,
        deliveryId,
        senderUserId: 'sender',
        senderDisplayName: 'Alex',
        recipientUserId: 'partner',
        occasion: mock.card['occasion'],
        tone: mock.card['tone'],
        locale: mock.card['locale'],
        title: mock.card['title'],
        body: mock.card['body'],
        citedMemoryIds: mock.card['citedMemoryIds'],
        deliveredAt: now,
      };
      return route.fulfill({ status: 202, json: { deliveryId, cardId, status, deliveryAt } });
    }
    if (path === `/cards/${cardId}`) {
      if (mock.card?.['status'] === 'QUEUED' && mock.pollsUntilSent-- <= 0)
        mock.card = { ...mock.card, status: 'SENT', deliveredAt: now };
      return route.fulfill({ json: mock.card });
    }
    if (path === '/inbox')
      return route.fulfill({ json: { items: mock.inbox === undefined ? [] : [mock.inbox] } });
    if (path === `/inbox/${cardId}/read`) {
      mock.inbox = { ...mock.inbox, readAt: now };
      return route.fulfill({ json: mock.inbox });
    }
    if (path === `/inbox/${cardId}`) return route.fulfill({ json: mock.inbox });
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  return mock;
};

for (const deliveryMode of ['immediate', 'scheduled'] as const)
  test(`${deliveryMode} card creation and inbox journey`, async ({ page }) => {
    const mock = await mockCards(page);
    await page.goto('/app/cards/new');
    await expect(page.getByRole('heading', { name: 'Una tarjeta para Sam' })).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('textbox', { name: 'Ocasión' }).fill('Anniversary');
    await page.getByRole('button', { name: 'Elegir recuerdos' }).click();
    const refs = page.getByRole('dialog', { name: 'Recuerdos de referencia' });
    await refs.getByRole('checkbox', { name: /Beach day/ }).check();
    await refs.getByRole('button', { name: 'Listo · 1 de 20' }).click();

    await page.getByRole('button', { name: 'Generar propuesta' }).click();
    await expect(page.getByText('Propuesta · aún no está en tu tarjeta')).toBeVisible();
    const message = page.getByRole('textbox', { name: 'Mensaje' });
    await message.fill('Keep this edit while I consider another suggestion.');
    await page.getByRole('button', { name: 'Descartar propuesta' }).click();
    await expect(message).toHaveValue('Keep this edit while I consider another suggestion.');

    await page.getByRole('button', { name: 'Generar otra propuesta' }).click();
    await page.getByRole('button', { name: 'Usar esta propuesta' }).click();
    await expect(page.getByText('Pulsa otra vez «Usar esta propuesta»')).toBeVisible();
    await expect(message).toHaveValue('Keep this edit while I consider another suggestion.');
    await page.getByRole('button', { name: 'Usar esta propuesta' }).click();
    await expect(message).toHaveValue('I still smile about our beach day.');
    await expect(page.getByRole('textbox', { name: 'Título' })).toHaveValue('Our beach day');

    await message.fill('I still smile about our wonderful beach day.');
    await page.getByRole('button', { name: 'Revisar y enviar' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/cards/${cardId}/review$`));
    await expect(page.getByRole('heading', { name: 'Revisa antes de enviar' })).toBeVisible();
    await expect(page.getByText('I still smile about our wonderful beach day.')).toBeVisible();
    expect(mock.requests.filter((r) => r.path.endsWith('/send'))).toHaveLength(0);

    if (deliveryMode === 'scheduled') {
      await page.getByText('Programar entrega').click();
      await page.getByLabel('Fecha', { exact: true }).fill('2030-01-15');
      await page.getByLabel('Hora', { exact: true }).fill('12:00');
      await expect(page.getByText(/Llegará a partir del 15 de enero de 2030, 12:00/)).toBeVisible();
      await expectAccessible(page);
      await page.getByRole('button', { name: 'Confirmar programación' }).click();
      await expect(page.getByRole('heading', { name: 'Tarjeta programada' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Confirmar envío' }).click();
      await expect(page.getByRole('heading', { name: 'Tu tarjeta está en camino' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Tu tarjeta se envió' })).toBeVisible({
        timeout: 10_000,
      });
    }
    const send = mock.requests.find((r) => r.path.endsWith('/send'))?.body;
    expect(send).toMatchObject({ confirmed: true, version: 1 });
    expect(String(send?.['idempotencyKey']).length).toBeGreaterThanOrEqual(16);

    await page.goto('/app/inbox');
    await page.getByText('Our beach day').click();
    await expect(page.getByText('I still smile about our wonderful beach day.')).toBeVisible();
  });

test('the review screen sends only the saved version', async ({ page }) => {
  const mock = await mockCards(page, draft());
  await page.goto(`/app/cards/${cardId}`);
  const message = page.getByRole('textbox', { name: 'Mensaje' });
  await message.fill('A newer message that is not saved yet.');
  await page.getByRole('button', { name: 'Revisar y enviar' }).click();

  await expect(page.getByText('Tienes cambios sin guardar.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar envío' })).toBeDisabled();
  await page.getByRole('link', { name: 'Volver a editar' }).first().click();
  await expect(message).toHaveValue('A newer message that is not saved yet.');

  await page.getByRole('button', { name: 'Revisar y enviar' }).click();
  await page.getByRole('button', { name: 'Guardar cambios y continuar' }).click();
  await expect(page.getByText('A newer message that is not saved yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar envío' })).toBeEnabled();
  expect(mock.requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({
    version: 1,
    body: 'A newer message that is not saved yet.',
  });
});

test('a past schedule is blocked before anything is sent', async ({ page }) => {
  const mock = await mockCards(page, draft());
  await page.goto(`/app/cards/${cardId}/review`);
  await page.getByText('Programar entrega').click();
  await page.getByLabel('Fecha', { exact: true }).fill('2020-01-01');
  await page.getByLabel('Hora', { exact: true }).fill('09:00');
  await page.getByRole('button', { name: 'Confirmar programación' }).click();
  await expect(page.getByText('Esa hora ya pasó. Elige un momento futuro.')).toBeVisible();
  expect(mock.requests.some((r) => r.path.endsWith('/send'))).toBe(false);
});

test('leaving the editor with changes asks first', async ({ page }) => {
  await mockCards(page, draft());
  await page.goto(`/app/cards/${cardId}`);
  await page.getByRole('textbox', { name: 'Título' }).fill('Otro título');
  await page.getByRole('button', { name: 'Tarjetas' }).click();
  const panel = page.getByRole('dialog', { name: '¿Salir sin guardar?' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page).toHaveURL(/\/app\/cards$/);
});

for (const viewport of [
  { name: 'phone', width: 320, height: 720 },
  { name: 'desktop', width: 1280, height: 800 },
] as const)
  test(`the card list shows server statuses at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockCards(page, draft({ status: 'DELIVERY_FAILED', version: 2 }));
    await page.goto('/app/cards');
    const link = page.getByRole('link', { name: 'Abrir tarjeta Our beach day, Error de entrega' });
    await expect(link).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/app/cards/${cardId}/view$`));
    await expect(page.getByText('No pudimos entregar esta tarjeta.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar mensaje' })).toBeVisible();
    await expectAccessible(page);
  });
