import { expect, test, type Page } from '@playwright/test';
import {
  authenticate,
  expectAccessible,
  expectNoHorizontalOverflow,
  now,
  profile,
} from './support';

const conversationId = '88888888-8888-4888-8888-888888888888';
const lakeId = '11111111-1111-4111-8111-111111111111';

const lake = {
  memoryId: lakeId,
  coupleId: 'couple',
  createdBy: 'sender',
  createdAt: now,
  updatedAt: now,
  ingestionStatus: 'INDEXED',
  version: 1,
  photos: [],
  title: 'Fin de semana en el lago',
  occurredOn: '2026-06-20',
  body: 'Remamos hasta la isla.',
  locale: 'es',
  tags: ['lago', 'viaje'],
  category: 'Viajes',
};

type Answer = 'grounded' | 'abstain' | 'fail-once';

interface ChatMock {
  messages: Record<string, unknown>[];
}

const mockChat = async (page: Page, answer: Answer): Promise<ChatMock> => {
  const mock: ChatMock = { messages: [] };
  let turns: Record<string, unknown>[] = [];
  let title = 'New conversation';
  await authenticate(page);
  await page.route('**/mock-api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/mock-api', '');
    const summary = { conversationId, title, createdAt: now, updatedAt: now };
    if (path === '/me') return route.fulfill({ json: profile });
    if (path === '/inbox') return route.fulfill({ json: { items: [] } });
    if (path === '/timeline') return route.fulfill({ json: { items: [lake] } });
    if (path === `/memories/${lakeId}`) return route.fulfill({ json: lake });
    if (path === '/conversations' && request.method() === 'POST')
      return route.fulfill({ status: 201, json: summary });
    if (path === '/conversations')
      return route.fulfill({ json: { items: turns.length ? [summary] : [] } });
    if (path === `/conversations/${conversationId}`)
      return route.fulfill({ json: { ...summary, turns } });
    if (path === `/conversations/${conversationId}/messages`) {
      const body = request.postDataJSON() as Record<string, unknown>;
      mock.messages.push(body);
      if (answer === 'fail-once' && mock.messages.length === 1)
        return route.fulfill({
          status: 503,
          json: { code: 'DEPENDENCY_FAILURE', message: 'Unavailable.' },
        });
      const grounded = answer !== 'abstain';
      const turn = {
        turnId: '99999999-9999-4999-8999-999999999999',
        requestId: body['requestId'],
        question: body['question'],
        status: 'COMPLETED',
        createdAt: now,
        answer: grounded
          ? 'En «Fin de semana en el lago» guardaron que remaron hasta la isla.'
          : 'No tengo suficiente información en los recuerdos compartidos para responder eso.',
        citations: grounded ? [{ memoryId: lakeId, title: lake.title, relevance: 0.9 }] : [],
        abstained: !grounded,
      };
      turns = [turn];
      title = String(body['question']);
      return route.fulfill({ status: 201, json: turn });
    }
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  return mock;
};

const ask = async (page: Page, question: string) => {
  await page.getByRole('textbox', { name: 'Tu pregunta' }).fill(question);
  await page.getByRole('button', { name: 'Preguntar' }).click();
};

for (const viewport of [
  { name: 'phone', width: 320, height: 720 },
  { name: 'desktop', width: 1280, height: 800 },
] as const)
  test(`a grounded answer links its memory at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockChat(page, 'grounded');
    await page.goto('/app/chat');
    await expect(
      page.getByRole('heading', { name: 'Conversar sobre nuestra historia' }),
    ).toBeVisible();

    await ask(page, '¿Qué hicimos en el lago?');

    await expect(page).toHaveURL(new RegExp(`/app/chat/${conversationId}$`));
    await expect(page.getByText('remaron hasta la isla')).toBeVisible();
    await expect(page.getByText('Basado en')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: '¿Qué hicimos en el lago?' }),
    ).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);

    await page.getByRole('link', { name: 'Abrir recuerdo Fin de semana en el lago' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/timeline/${lakeId}\\?from=`));
    await page.getByRole('button', { name: 'Conversar' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/chat/${conversationId}$`));
  });

test('an abstention says no memory supports the answer', async ({ page }) => {
  await mockChat(page, 'abstain');
  await page.goto('/app/chat');
  await ask(page, '¿Cuándo nos casamos?');
  await expect(page.getByText('No hay un recuerdo disponible que respalde')).toBeVisible();
  await expect(page.getByText('Basado en')).toHaveCount(0);
});

test('retrying a failed question reuses its request ID', async ({ page }) => {
  const mock = await mockChat(page, 'fail-once');
  await page.goto('/app/chat');
  await ask(page, '¿Qué hicimos en el lago?');

  await expect(
    page.getByText('No pudimos obtener una respuesta. Tu pregunta sigue aquí.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('remaron hasta la isla')).toBeVisible();
  expect(mock.messages).toHaveLength(2);
  expect(mock.messages[1]?.['requestId']).toBe(mock.messages[0]?.['requestId']);
  expect(mock.messages[1]?.['question']).toBe(mock.messages[0]?.['question']);
});

test('filters narrow the search and block an inverted date range', async ({ page }) => {
  const mock = await mockChat(page, 'grounded');
  await page.goto('/app/chat');

  await page.getByRole('button', { name: 'Filtros' }).click();
  const panel = page.getByRole('dialog', { name: 'Filtros' });
  await panel.getByLabel('Fecha inicial').fill('2026-07-01');
  await panel.getByLabel('Fecha final').fill('2026-06-01');
  await expect(panel.getByText('La fecha inicial es posterior a la final.')).toBeVisible();
  await panel.getByLabel('Fecha inicial').fill('2026-01-01');
  await panel.getByText('Viajes').click();
  await panel.getByText('#lago').click();
  await expectAccessible(page);
  await panel.getByRole('button', { name: 'Aplicar' }).click();

  await expect(page.getByRole('button', { name: 'Filtros (4)' })).toBeVisible();
  await page.getByRole('button', { name: 'Quitar filtro hasta 1 jun 2026' }).click();
  await ask(page, '¿Qué hicimos en el lago?');
  await expect(page.getByText('remaron hasta la isla')).toBeVisible();
  expect(mock.messages[0]?.['filters']).toEqual({
    occurredOnFrom: '2026-01-01',
    category: 'Viajes',
    tags: ['lago'],
  });
});
