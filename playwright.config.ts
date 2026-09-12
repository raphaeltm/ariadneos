import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "list",
  retries: 0,
  testDir: "./tests/e2e",
  use: {
    baseURL: process.env.ARIADNE_TEST_URL ?? "http://127.0.0.1:8789",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  workers: 1,
});
