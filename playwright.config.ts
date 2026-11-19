import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = Number(process.env.E2E_PORT ?? "3333");
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// Uploads require durable storage (upload route guard). e2e may only use a
// LOCAL Supabase stack (scripts/e2e-local-supabase.sh): its env is passed
// through solely when SUPABASE_URL points at this machine, so a hosted
// project's credentials can never reach the e2e server.
const LOCAL_SUPABASE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(process.env.SUPABASE_URL ?? "");
const localSupabase = (name: string): string => (LOCAL_SUPABASE ? process.env[name] ?? "" : "");

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // The suite shares one Next.js dev server and process-local test sessions.
  // A bounded two-worker pool keeps PDF.js rendering and session-scoped uploads
  // parallel without starving unrelated assertions on lower-resource hosts.
  workers: 2,
  reporter: "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    // e2e assertions are written against the deterministic engine; blank
    // credentials here win over .env.local so /api/extract never auto-picks
    // the LLM in CI or locally. Supabase is blank (so .env.local never leaks
    // a hosted project in) unless a LOCAL stack is configured above; live
    // persistence is proven by the integration suite instead.
    env: {
      LLM_BASE_URL: "",
      LLM_API_KEY: "",
      LLM_MODEL: "",
      // Embeddings are a paid provider call on upload (durable chunks) and in
      // chat retrieval: always blank in e2e (lexical retrieval, null vectors).
      EMBEDDING_BASE_URL: "",
      EMBEDDING_API_KEY: "",
      EMBEDDING_MODEL: "",
      SUPABASE_URL: localSupabase("SUPABASE_URL"),
      SUPABASE_SECRET_KEY: localSupabase("SUPABASE_SECRET_KEY"),
      SUPABASE_SERVICE_KEY: "",
      SUPABASE_STORAGE_BUCKET: localSupabase("SUPABASE_STORAGE_BUCKET"),
      E2E_DIST_DIR: ".next-e2e",
    },
    url: E2E_BASE_URL,
    // Never reuse an arbitrary app that happens to be listening on the test
    // port. The previous config reused localhost:3000, so a developer's
    // already-running server could make Playwright test the wrong process.
    reuseExistingServer: false,
    timeout: 120000,
  },
});
