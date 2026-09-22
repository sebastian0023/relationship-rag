import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const runtimeConfig = {
  apiOrigin: 'http://127.0.0.1:4200/mock-api',
  authority: 'http://127.0.0.1:4200/mock-oidc',
  clientId: 'e2e-client',
  scope: 'openid profile email relationship-rag/access',
};

for (const viewport of [
  { name: 'mobile', width: 320, height: 720 },
  { name: 'desktop', width: 1280, height: 800 },
] as const) {
  test(`login is accessible at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/assets/runtime-config.json', (route) =>
      route.fulfill({ json: runtimeConfig }),
    );
    await page.goto('/login');

    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter(
        (violation) => violation.impact === 'critical' || violation.impact === 'serious',
      ),
    ).toEqual([]);
    const overflowing = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < -1 || bounds.right > window.innerWidth + 1;
        })
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          bounds: element.getBoundingClientRect().toJSON(),
        })),
    );
    expect(overflowing).toEqual([]);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Sign in with your invitation' })).toBeFocused();
  });
}
