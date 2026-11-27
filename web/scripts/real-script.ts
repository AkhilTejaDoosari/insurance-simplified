// Runs a real-document script kept outside git at
// REAL_FIXTURES_DIR/scripts/<name> (it names licensed brochures and quotes
// them). Without the fixtures it prints SKIP and exits 0 — never a pass.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function runRealScript(name: string): void {
  const dir = process.env.REAL_FIXTURES_DIR?.trim();
  const file = dir ? join(resolve(dir), "scripts", name) : "";
  if (!file || !existsSync(file)) {
    console.log(`SKIP: ${name} is a real-document script (set REAL_FIXTURES_DIR)`);
    process.exit(0);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(file);
}
