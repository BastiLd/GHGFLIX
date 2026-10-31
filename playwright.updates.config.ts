import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/updates', outputDir: './test-results/updates-browser', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:19850', headless: true },
  webServer: [
    { command: 'node tests/integration/account-server.mjs', url: 'http://127.0.0.1:19848/api/ping', reuseExistingServer: false },
    { command: 'node tests/integration/webhafen-proxy.mjs', url: 'http://127.0.0.1:19850/', reuseExistingServer: false },
  ],
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }, { name: 'phone', use: { viewport: { width: 390, height: 844 } } }],
});
