import { defineConfig } from '@playwright/test';

const baseURL = process.env['PHASE7_BASE_URL'];
if (baseURL === undefined) throw new Error('PHASE7_BASE_URL is required for deployed tests.');

export default defineConfig({
  testDir: './e2e-live',
  timeout: 60_000,
  retries: 1,
  use: { baseURL, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [
    ['./e2e-release/safe-reporter.ts', { outputFile: 'phase7-evidence/live-summary.json' }],
  ],
});
