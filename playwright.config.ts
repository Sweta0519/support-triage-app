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
      // auth.setup.ts (sign in customer A) and reset.setup.ts (clear test
      // accounts' rate-limit counters) both run here, before every suite run.
      name: "setup",
      testMatch: /\.setup\.ts$/,
      // After every run, delete the probe tickets the suite filed in the
      // shared project (tests/cleanup.teardown.ts).
      teardown: "cleanup",
    },
    {
      name: "cleanup",
      testMatch: /\.teardown\.ts$/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/customerA.json" },
      dependencies: ["setup"],
      testIgnore: [/\.(setup|teardown)\.ts$/, /(account-settings|people|ai-health|incidents)\.spec\.ts$/],
    },
    {
      // Changes the shared test accounts' theme, queue defaults and display
      // names, so it runs after the main suite rather than alongside it (if a main-suite
      // test fails, this shows as "did not run"). On its own:
      // npx playwright test --project=settings --no-deps
      // To rerun several of these last projects, add --workers=1: --no-deps
      // drops their ordering, and in parallel they race on the shared accounts.
      name: "settings",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["chromium"],
      testMatch: /account-settings\.spec\.ts$/,
    },
    {
      // Gives the agent a display name; after "settings", which resets it.
      name: "people",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["settings"],
      testMatch: /people\.spec\.ts$/,
    },
    {
      // Seeds a team-wide streak of failed triage runs, which puts the "AI
      // triage is failing" banner on every staff page while it runs, so it
      // goes last, alone. On its own: npx playwright test --project=ai-health --no-deps
      name: "ai-health",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["people"],
      testMatch: /ai-health\.spec\.ts$/,
    },
    {
      // Seeds incidents, which put a banner on every staff page while they're
      // open, so it runs after everything else, alone.
      // On its own: npx playwright test --project=incidents --no-deps
      name: "incidents",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["ai-health"],
      testMatch: /incidents\.spec\.ts$/,
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
