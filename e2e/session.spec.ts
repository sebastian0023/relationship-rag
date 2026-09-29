import { expect, test, type Page } from '@playwright/test';
import {
  authenticate,
  expectAccessible,
  expectNoHorizontalOverflow,
  oidcStorageKey,
  profile,
} from './support';

const noSilentRenew = async (page: Page) => {
  // Metadata without an authorization endpoint makes the silent refresh fail fast.
  await page.route('**/mock-oidc/.well-known/openid-configuration', (route) =>
    route.fulfill({ json: { issuer: 'http://127.0.0.1:4200/mock-oidc' } }),
  );
};

test('an expired session explains itself and keeps the place to return to', async ({ page }) => {
  await authenticate(page);
  await noSilentRenew(page);
  await page.route('**/mock-api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/mock-api', '');
    if (path === '/me') return route.fulfill({ json: profile });
    if (path === '/inbox') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 401, json: { code: 'UNAUTHORIZED', message: 'Expired.' } });
  });

  await page.goto('/app/timeline');

  await expect(page.getByRole('heading', { name: 'Tu sesión terminó' })).toBeVisible();
  await expect(page).toHaveURL(/\/session-expired\?returnTo=%2Fapp%2Ftimeline$/);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), oidcStorageKey)).toBeNull();
  await expect(page.getByRole('button', { name: 'Volver a entrar' })).toBeVisible();
  await expectAccessible(page);
});

test('an account without active membership sees only the private-space notice', async ({
  page,
}) => {
  await authenticate(page);
  await page.route('**/mock-api/me', (route) =>
    route.fulfill({ status: 403, json: { code: 'FORBIDDEN', message: 'Forbidden.' } }),
  );

  await page.goto('/app/timeline');

  await expect(page).toHaveURL(/\/access-denied$/);
  await expect(page.getByRole('heading', { name: 'Este espacio es privado' })).toBeVisible();
  await expect(page.getByText('Alex')).toHaveCount(0);
  await expectAccessible(page);
});

for (const viewport of [
  { name: 'phone', width: 320, height: 720, nav: 'bottom' },
  { name: 'tablet', width: 820, height: 1000, nav: 'rail' },
  { name: 'desktop', width: 1280, height: 800, nav: 'sidebar' },
] as const) {
  test(`the shell navigation works at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await authenticate(page);
    await page.route('**/mock-api/**', (route) => {
      const path = new URL(route.request().url()).pathname.replace('/mock-api', '');
      if (path === '/me') return route.fulfill({ json: profile });
      if (path === '/inbox')
        return route.fulfill({
          json: {
            items: [
              {
                cardId: '22222222-2222-4222-8222-222222222222',
                deliveryId: '33333333-3333-4333-8333-333333333333',
                senderUserId: 'partner',
                senderDisplayName: 'Sam',
                recipientUserId: 'sender',
                occasion: 'Aniversario',
                tone: 'AFFECTIONATE',
                locale: 'es',
                title: 'Para ti',
                body: 'Hola.',
                citedMemoryIds: [],
                deliveredAt: '2026-09-21T12:00:00.000Z',
              },
            ],
          },
        });
      if (path === '/timeline') return route.fulfill({ json: { items: [] } });
      return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found' } });
    });

    await page.goto('/app/timeline');

    const current = page.getByRole('link', { name: 'Recuerdos', exact: true });
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Buzón, 1 sin leer' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if (viewport.nav === 'sidebar') {
      await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Menú de sesión de Alex' }).click();
      const panel = page.getByRole('dialog', { name: 'Alex' });
      await expect(panel).toBeVisible();
      await expect(panel.getByText('alex@example.test')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(page.getByRole('button', { name: 'Menú de sesión de Alex' })).toBeFocused();
    }
  });
}
