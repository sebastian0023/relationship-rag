import { defineConfig } from '@playwright/test';

if (!process.env['PHASE7_BASE_URL']) throw new Error('PHASE7_BASE_URL is required.');

export default defineConfig({
  testDir: './e2e-live',
  testMatch: 'backend.spec.ts',
  timeout: 25 * 60_000,
  retries: 0,
  workers: 1,
  use: { baseURL: process.env['PHASE7_BASE_URL'], trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: 'list',
});
