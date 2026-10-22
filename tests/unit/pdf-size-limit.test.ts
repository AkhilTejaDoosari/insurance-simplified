import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPages, MAX_FILE_BYTES } from "@/app/lib/pdf/extract-pages";

const FIXTURE = join(process.cwd(), "tests/fixtures/plan-a.pdf");

describe("PDF upload size limit", () => {
  it("is 20 MiB", () => {
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it("extracts a real PDF below the limit", async () => {
    const bytes = readFileSync(FIXTURE);
    expect(bytes.length).toBeLessThan(MAX_FILE_BYTES);
    const result = await extractPages(bytes, "plan-a.pdf");
    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.pages.join("\n").length).toBeGreaterThan(0);
  });

  it("does not apply the size rejection at exactly the limit", async () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES);
    await expect(extractPages(bytes, "at-limit.pdf")).rejects.toMatchObject({
      reason: "not-pdf",
    });
  });

  it("rejects one byte above the limit with over-size-limit", async () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES + 1);
    await expect(extractPages(bytes, "over-limit.pdf")).rejects.toMatchObject({
      reason: "over-size-limit",
    });
  });

  it("names the 20 MB limit in the rejection message", async () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES + 1);
    await expect(extractPages(bytes, "over-limit.pdf")).rejects.toThrow(/20 MB/);
  });
});
