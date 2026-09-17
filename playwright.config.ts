import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    // e2e assertions are written against the deterministic engine; blank
    // credentials here win over .env.local so /api/extract never auto-picks
    // the LLM in CI or locally.
    env: { LLM_BASE_URL: "", LLM_API_KEY: "" },
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
