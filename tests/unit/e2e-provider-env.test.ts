// The e2e web server loads .env.local, so every provider variable must be set
// explicitly to "" in playwright.config.ts or a real (paid) provider is called.
// The variable set is discovered, not hard-coded: every name ending in
// _API_KEY, _BASE_URL or _MODEL in .env.example or read via process.env in
// app/ or scripts/. SUPABASE_* are exempt only for a localhost SUPABASE_URL.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
const SUFFIX = /_(API_KEY|BASE_URL|MODEL)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
  });
}

function providerVariableNames(): string[] {
  const names = new Set<string>();
  for (const m of readFileSync(join(ROOT, ".env.example"), "utf8").matchAll(/^([A-Z0-9_]+)=/gm)) names.add(m[1]);
  for (const file of [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "scripts"))]) {
    for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) names.add(m[1]);
  }
  return [...names].filter((n) => SUFFIX.test(n)).sort();
}

async function webServerEnv(supabaseUrl: string): Promise<Record<string, string>> {
  vi.resetModules();
  vi.stubEnv("SUPABASE_URL", supabaseUrl);
  const config = (await import("@/playwright.config")).default;
  const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
  return (server?.env ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("e2e web server never inherits provider credentials", () => {
  const names = providerVariableNames();

  it("discovers the provider variables", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each([
    ["hosted Supabase URL", "https://project.supabase.co", false],
    ["localhost Supabase URL", "http://127.0.0.1:54321", true],
  ])("with a %s, every *_API_KEY/*_BASE_URL/*_MODEL is set to empty", async (_label, url, local) => {
    const env = await webServerEnv(url);
    for (const name of names) {
      if (local && name.startsWith("SUPABASE_")) continue;
      expect({ name, value: env[name] }).toEqual({ name, value: "" });
    }
  });
});
