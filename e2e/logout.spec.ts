import { expect, test } from '@playwright/test';

test('sign out uses the Cognito logout parameters and returns to login', async ({ page }) => {
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
  await page.route('**/mock-api/me', (route) =>
    route.fulfill({
      json: { userId: 'sender', coupleId: 'couple', role: 'OWNER', displayName: 'Alex' },
    }),
  );
  await page.route('**/.well-known/openid-configuration', (route) =>
    route.fulfill({
      json: {
        issuer: 'http://127.0.0.1:4200/mock-oidc',
        end_session_endpoint: 'http://127.0.0.1:4200/mock-oidc/logout',
      },
    }),
  );
  let logoutUrl: URL | undefined;
  await page.route('**/mock-oidc/logout**', (route) => {
    logoutUrl = new URL(route.request().url());
    return route.fulfill({ status: 302, headers: { location: '/login' }, body: '' });
  });

  await page.goto('/login');
  await page.evaluate(() => {
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
  await page.goto('/app/timeline');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await expect(page).toHaveURL(/\/login$/);
  // The last match is the visible toast; the first is the screen-reader live region.
  await expect(page.getByText('Cerraste sesión. Hasta pronto.').last()).toBeVisible();
  expect(logoutUrl?.searchParams.get('client_id')).toBe('e2e-client');
  expect(logoutUrl?.searchParams.get('logout_uri')).toBe('http://127.0.0.1:4200/');
  expect(logoutUrl?.searchParams.has('post_logout_redirect_uri')).toBe(false);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('oidc.user:http://127.0.0.1:4200/mock-oidc:e2e-client'),
    ),
  ).toBeNull();
});
