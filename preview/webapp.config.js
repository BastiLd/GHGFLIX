import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: 'webapp-test', timeout: 45000, workers: 1, reporter: [['list']], use: { baseURL: 'http://127.0.0.1:19844', screenshot: 'only-on-failure', trace: 'retain-on-failure' }, projects: [
  { name: 'chromium-touch', use: { ...devices['Pixel 7'], browserName: 'chromium', channel: 'chrome' } },
  { name: 'webkit-iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
] });
