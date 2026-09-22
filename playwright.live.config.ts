import { defineConfig } from '@playwright/test';

const baseURL = process.env['PHASE7_BASE_URL'];
if (baseURL === undefined) throw new Error('PHASE7_BASE_URL is required for deployed tests.');

export default defineConfig({
  testDir: './e2e-live',
  timeout: 60_000,
  retries: 1,
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['html', { outputFolder: 'phase7-evidence/playwright', open: 'never' }]],
});
