import { expect, test, type Page } from '@playwright/test';
import {
  authenticate,
  expectAccessible,
  expectNoHorizontalOverflow,
  now,
  profile,
} from './support';

const unreadId = '22222222-2222-4222-8222-222222222221';
const readId = '22222222-2222-4222-8222-222222222222';
const memoryId = '11111111-1111-4111-8111-111111111111';

const letter = (cardId: string, overrides: Record<string, unknown> = {}) => ({
  cardId,
  deliveryId: '33333333-3333-4333-8333-333333333333',
  senderUserId: 'partner',
  senderDisplayName: 'Sam',
  recipientUserId: 'sender',
  occasion: 'Lluvia',
  tone: 'AFFECTIONATE',
  locale: 'es',
  title: 'Una tarjeta para ti',
  body: 'Todavía pienso en la tarde de la librería.',
  citedMemoryIds: [memoryId],
  deliveredAt: '2026-09-20T10:00:00.000Z',
  ...overrides,
});

const mockInbox = async (page: Page) => {
  const reads: string[] = [];
  const items = new Map([
    [unreadId, letter(unreadId)],
    [readId, letter(readId, { title: 'Feliz aniversario', citedMemoryIds: [], readAt: now })],
  ]);
  await authenticate(page);
  await page.route('**/mock-api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/mock-api', '');
    if (path === '/me') return route.fulfill({ json: profile });
    if (path === '/cards/recipients')
      return route.fulfill({ json: { items: [{ userId: 'partner', displayName: 'Sam' }] } });
    if (path === '/inbox') return route.fulfill({ json: { items: [...items.values()] } });
    if (path === `/memories/${memoryId}`)
      return route.fulfill({
        json: {
          memoryId,
          coupleId: 'couple',
          createdBy: 'sender',
          createdAt: now,
          updatedAt: now,
          ingestionStatus: 'INDEXED',
          version: 1,
          photos: [],
          title: 'Tarde de lluvia en la librería',
          occurredOn: '2026-09-14',
          body: 'Nos refugiamos de la lluvia.',
          locale: 'es',
          tags: [],
        },
      });
    const [, , id, action] = path.split('/');
    const item = id === undefined ? undefined : items.get(id);
    if (item === undefined)
      return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found' } });
    if (action === 'read') {
      reads.push(item.cardId);
      const updated = { ...item, readAt: now };
      items.set(item.cardId, updated);
      return route.fulfill({ json: updated });
    }
    return route.fulfill({ json: item });
  });
  return reads;
};

for (const viewport of [
  { name: 'phone', width: 320, height: 720 },
  { name: 'desktop', width: 1280, height: 800 },
] as const)
  test(`the inbox marks unread letters at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockInbox(page);
    await page.goto('/app/inbox');
    await expect(page.getByText('1 sin leer', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', {
        name: 'Sin leer. Tarjeta de Sam: Una tarjeta para ti, entregada el 20 de septiembre de 2026',
      }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Buzón, 1 sin leer' })).toBeVisible();
    await expectAccessible(page);
    await expectNoHorizontalOverflow(page);
  });

test('opening a letter can skip the animation and marks it read', async ({ page }) => {
  const reads = await mockInbox(page);
  await page.goto('/app/inbox');
  await page.getByRole('link', { name: /Una tarjeta para ti/ }).click();

  await expect(page.getByText('Abriendo la tarjeta de Sam…')).toBeVisible();
  await page.getByRole('button', { name: 'Saltar animación' }).click();
  await expect(page.getByRole('heading', { name: 'Una tarjeta para ti' })).toBeVisible();
  await expect(page.getByText('Todavía pienso en la tarde de la librería.')).toBeVisible();
  expect(reads).toEqual([unreadId]);
  await expect(
    page
      .getByRole('navigation', { name: 'Secciones' })
      .getByRole('link', { name: 'Buzón', exact: true }),
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: /Tarde de lluvia en la librería/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/timeline/${memoryId}\\?from=`));
  await page.getByRole('button', { name: 'Buzón' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/inbox/${unreadId}$`));
});

test('with reduced motion the letter opens directly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockInbox(page);
  await page.goto(`/app/inbox/${readId}`);
  await expect(page.getByRole('heading', { name: 'Feliz aniversario' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saltar animación' })).toHaveCount(0);
});
