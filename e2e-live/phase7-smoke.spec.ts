import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const username = process.env['PHASE7_TEST_USERNAME'];
const password = process.env['PHASE7_TEST_PASSWORD'];
if (username === undefined || password === undefined)
  throw new Error('Synthetic test user credentials are required.');

test('real Cognito user can access the private test-stage API', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with your invitation' }).click();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"], input[type="submit"]').click();

  await page.waitForURL(/\/app(?:\/|$)/);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/timeline/);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    ),
  ).toEqual([]);
});
