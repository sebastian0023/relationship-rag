import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const runtimeConfig = {
  apiOrigin: 'http://127.0.0.1:4200/mock-api',
  authority: 'http://127.0.0.1:4200/mock-oidc',
  clientId: 'e2e-client',
  scope: 'openid profile email relationship-rag/access',
};

export const oidcStorageKey = 'oidc.user:http://127.0.0.1:4200/mock-oidc:e2e-client';

export const now = '2026-09-21T12:00:00.000Z';

/** Serves the runtime configuration and a signed-in synthetic session. */
export const authenticate = async (page: Page) => {
  await page.route('**/assets/runtime-config.json', (route) =>
    route.fulfill({ json: runtimeConfig }),
  );
  await page.addInitScript((key) => {
    // Seed once per tab, in the top frame only, so a sign-out or expiry is not undone by a
    // later document (including the silent-renew iframe).
    if (window !== window.top || sessionStorage.getItem('e2e.seeded') !== null) return;
    sessionStorage.setItem('e2e.seeded', '1');
    sessionStorage.setItem(
      key,
      JSON.stringify({
        access_token: 'synthetic-token',
        token_type: 'Bearer',
        scope: 'openid profile email relationship-rag/access',
        profile: { sub: 'sender', email: 'alex@example.test' },
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
  }, oidcStorageKey);
};

export const profile = { userId: 'sender', coupleId: 'couple', role: 'OWNER', displayName: 'Alex' };

/** Fails the test on serious or critical axe violations. */
export const expectAccessible = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    ),
  ).toEqual([]);
};

/**
 * Fails the test if any element overflows the viewport horizontally. Content inside an intentional
 * horizontal scroller, marked with `data-scroll-x` (such as a row of filter chips), may extend.
 */
export const expectNoHorizontalOverflow = async (page: Page) => {
  const overflowing = await page.evaluate(() => {
    const clipped = (element: HTMLElement) =>
      (element.parentElement?.closest('[data-scroll-x]') ?? null) !== null;
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          element.getClientRects().length > 0 &&
          (bounds.left < -1 || bounds.right > window.innerWidth + 1) &&
          !clipped(element)
        );
      })
      .map((element) => ({ tag: element.tagName, className: String(element.className) }));
  });
  expect(overflowing).toEqual([]);
};
