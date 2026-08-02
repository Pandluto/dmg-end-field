import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3040';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: 'line',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:e2e',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
