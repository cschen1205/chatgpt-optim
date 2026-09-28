import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 60000,
  use: {
    headless: true,
    viewport: { width: 1100, height: 800 },
    launchOptions: {
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      args: ["--no-sandbox"],
    },
  },
});
