import { describe, expect, it } from "vitest";
import { documentUrl, rawDocumentUrl } from "@/app/lib/document-url";

describe("documentUrl (citation viewer links)", () => {
  it("points at the app-owned viewer with the page as a query parameter", () => {
    expect(documentUrl("sess-1", "doc-1", "plan-a.pdf", 3)).toBe(
      "/view/sess-1/doc-1/plan-a.pdf?page=3",
    );
  });
  it("ends the path with the filename so the browser tab is named after it", () => {
    expect(documentUrl("sess-1", "doc-1", "plan-a.pdf", 1)).toMatch(
      /\/plan-a\.pdf\?page=1$/,
    );
  });
  it("encodes filenames and omits the page parameter without a page", () => {
    expect(documentUrl("sess-1", "doc-2", "Patriot Travel #2 (2026).pdf")).toBe(
      "/view/sess-1/doc-2/Patriot%20Travel%20%232%20(2026).pdf",
    );
  });
});

describe("rawDocumentUrl (uploaded PDF bytes)", () => {
  it("points at the document endpoint with the encoded filename last", () => {
    expect(rawDocumentUrl("sess-1", "doc-2", "Patriot Travel #2 (2026).pdf")).toBe(
      "/api/document/sess-1/doc-2/Patriot%20Travel%20%232%20(2026).pdf",
    );
  });
});
