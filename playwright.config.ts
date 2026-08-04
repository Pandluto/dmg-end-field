import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3040';
const webServerCommand = process.env.E2E_SERVER_COMMAND || 'npm run dev:e2e';
const skipWebServer = /^(1|true)$/i.test(process.env.E2E_SKIP_WEB_SERVER?.trim() || '');

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
  webServer: skipWebServer ? undefined : {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
