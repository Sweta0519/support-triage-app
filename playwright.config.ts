import { defineConfig, devices } from "@playwright/test";

// Load TEST_USER_* from .env.local for tests/auth.setup.ts. No-op if the
// file is missing (e.g. on CI, where these would be set as real env vars).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not present -- fall through to whatever the environment already has.
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  /* Chromium only for this course. */
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/customerA.json" },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
