// Loader for the real-document evaluation labels. The labels quote licensed
// brochure text and name the real PDFs, so they live outside git in
// REAL_FIXTURES_DIR/p2-experiment/<name>.ts (gitignored `real-fixtures/` by
// convention). Without them a script prints SKIP and exits 0 — never a score.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function realFixture<T>(name: string): T {
  const dir = process.env.REAL_FIXTURES_DIR?.trim();
  const file = dir ? join(resolve(dir), "p2-experiment", `${name}.ts`) : "";
  if (!file || !existsSync(file)) {
    console.log(`SKIP: ${name} labels not found (set REAL_FIXTURES_DIR; real-document labels are not in git)`);
    process.exit(0);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(file) as T;
}
