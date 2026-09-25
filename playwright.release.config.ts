import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-release',
  timeout: 1_800_000,
  retries: 0,
  workers: 1,
  use: {
    actionTimeout: 30000,
    navigationTimeout: 30000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  reporter: [['./e2e-release/safe-reporter.ts']],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
