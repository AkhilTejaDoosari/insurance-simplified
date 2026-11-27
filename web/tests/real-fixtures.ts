// Real-document test data lives OUTSIDE git: licensed brochure text, labels
// adjudicated against it, and the real PDF filenames. Point REAL_FIXTURES_DIR
// at the owner's local copy (gitignored `real-fixtures/` by convention).
// Without it every real-document suite reports SKIPPED — never a pass.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "vitest";

export function realFixturesDir(): string | undefined {
  const dir = process.env.REAL_FIXTURES_DIR?.trim();
  if (!dir) return undefined;
  const abs = resolve(dir);
  return existsSync(abs) ? abs : undefined;
}

/** Absolute path of a file inside REAL_FIXTURES_DIR, or undefined if absent. */
export function realFixturePath(relative: string): string | undefined {
  const dir = realFixturesDir();
  if (!dir) return undefined;
  const file = join(dir, relative);
  return existsSync(file) ? file : undefined;
}

/** Load a real-document suite kept at REAL_FIXTURES_DIR/tests/<relative>,
 *  or register it as SKIPPED when the fixtures are absent. */
export async function realSuite(relative: string): Promise<void> {
  const file = realFixturePath(join("tests", relative));
  if (!file) {
    describe.skip(`${relative} — real-document suite (set REAL_FIXTURES_DIR)`, () => {
      it("requires the local real-document fixtures", () => {});
    });
    return;
  }
  await import(/* @vite-ignore */ file);
}
