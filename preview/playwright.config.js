import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test", timeout: 30000, workers: 1,
  use: { baseURL: "http://127.0.0.1:5188", channel: "chrome", headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:5188/app.html", reuseExistingServer: false },
  reporter: [["list"]],
});
