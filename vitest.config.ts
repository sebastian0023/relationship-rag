import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages,services}/**/*.spec.ts', 'scripts/release/*.test.mjs'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      exclude: ['**/*.spec.ts', '**/index.ts', 'apps/infrastructure/**'],
    },
  },
  resolve: {
    alias: {
      '@relationship-rag/contracts': new URL('./packages/contracts/src/index.ts', import.meta.url)
        .pathname,
      '@relationship-rag/domain': new URL('./packages/domain/src/index.ts', import.meta.url)
        .pathname,
      '@relationship-rag/observability': new URL(
        './packages/observability/src/index.ts',
        import.meta.url,
      ).pathname,
      '@relationship-rag/test-utils': new URL('./packages/test-utils/src/index.ts', import.meta.url)
        .pathname,
    },
  },
});
