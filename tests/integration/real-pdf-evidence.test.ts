import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPages } from "@/app/lib/pdf/extract-pages";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";

// Real-document regression for ellipsis repair. Runs only when REAL_PDFS_DIR
// points at a directory containing patriot-exchange-brochure.pdf and
// OPTima_26_27_A.pdf (e.g. local validation); skipped in CI.
const DIR = process.env.REAL_PDFS_DIR ?? "";
const enabled =
  DIR !== "" &&
  existsSync(join(DIR, "patriot-exchange-brochure.pdf")) &&
  existsSync(join(DIR, "OPTima_26_27_A.pdf"));

async function pagesOf(filename: string): Promise<string[]> {
  const buf = readFileSync(join(DIR, filename));
  const bytes = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return (await extractPages(bytes, filename)).pages;
}

function docsFor(documentId: string, pages: string[]) {
  return [{ documentId, pageCount: pages.length, pages }];
}

describe.runIf(enabled)("real-PDF ellipsis repair", () => {
  it("Patriot Exchange p5: condensed waiting-period quote canonicalizes to source span", async () => {
    const pages = await pagesOf("patriot-exchange-brochure.pdf");
    const res = verifyEvidenceCitation(
      docsFor("doc-1", pages),
      {
        documentId: "doc-1",
        page: 5,
        quote: "Pre-existing conditions ... excluded until the Insured Person has maintained 12 months of continuous coverage",
      }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.quote).not.toContain("...");
    expect(res.quote).toContain("12 months of continuous coverage");
    expect(res.quote.length).toBeLessThanOrEqual(600);
    // Canonical text is verbatim page text.
    expect(pages[4]).toContain(res.quote);
  });

  it("OPTima p8: condensed definition quote canonicalizes to source span", async () => {
    const pages = await pagesOf("OPTima_26_27_A.pdf");
    const res = verifyEvidenceCitation(
      docsFor("doc-2", pages),
      {
        documentId: "doc-2",
        page: 8,
        quote:
          "Plan Participant means a person ... has his or her true fixed or permanent home and principal establishment outside of the United States ...",
      }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.quote).not.toContain("...");
    expect(res.quote).toContain("principal establishment outside of the United States");
    expect(res.quote.length).toBeLessThanOrEqual(600);
    expect(pages[7]).toContain(res.quote);
  });
});
