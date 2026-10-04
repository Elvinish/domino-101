import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-fake-device-for-media-stream'] },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
      },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @domino/server start',
      url: 'http://127.0.0.1:3101/health',
      env: {
        PORT: '3101',
        HOST: '127.0.0.1',
        WEB_ORIGIN: 'http://127.0.0.1:4173',
        LOG_LEVEL: 'silent',
      },
      reuseExistingServer: false,
    },
    {
      command:
        'pnpm --filter @domino/web build && pnpm --filter @domino/web preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      env: {
        VITE_API_BASE_URL: 'http://127.0.0.1:3101',
        VITE_WEBRTC_ICE_SERVERS: '[]',
      },
      reuseExistingServer: false,
    },
  ],
});
