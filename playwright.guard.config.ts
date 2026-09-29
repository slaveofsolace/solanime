import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/guard',
  testMatch: '**/*.spec.mjs',
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  outputDir: 'test-results/guard',
  reporter: [['list']],
  webServer: {
    command: 'node --import tsx tests/e2e/server.ts',
    url: 'http://127.0.0.1:18787/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
