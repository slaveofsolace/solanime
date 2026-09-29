import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/private-e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results/private-site',
  use: { baseURL: 'http://127.0.0.1:18788', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx tests/e2e/private-server.ts',
    url: 'http://127.0.0.1:18788/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'private-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'private-android', use: { ...devices['Pixel 7'] } },
    { name: 'private-iphone', use: { ...devices['iPhone 13'] } },
  ],
});
