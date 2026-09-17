import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 3100;
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- -p ${E2E_PORT}`,
    // e2e assertions are written against the deterministic engine; blank
    // credentials here win over .env.local so /api/extract never auto-picks
    // the LLM in CI or locally.
    env: { LLM_BASE_URL: "", LLM_API_KEY: "" },
    url: E2E_BASE_URL,
    // Never reuse an arbitrary app that happens to be listening on the test
    // port. The previous config reused localhost:3000, so a developer's
    // already-running server could make Playwright test the wrong process.
    reuseExistingServer: false,
    timeout: 120000,
  },
});
