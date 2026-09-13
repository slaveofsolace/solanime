import { defineConfig } from '@playwright/test';
import path from 'node:path';

const artifacts = path.resolve(process.env.BRANDING_TEST_OUTPUT ?? 'test-results/branding');

export default defineConfig({
  testDir: '../../tests/branding-browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20000,
  expect: { timeout: 7000 },
  outputDir: path.join(artifacts, 'runs'),
  reporter: [['list'], ['json', { outputFile: path.join(artifacts, 'results.json') }]],
  use: {
    baseURL: 'http://127.0.0.1:5188',
    reducedMotion: 'no-preference',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'on',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'mobile', use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5188 --strictPort',
    url: 'http://127.0.0.1:5188/branding.html',
    reuseExistingServer: true,
    cwd: path.resolve('.'),
  },
});
