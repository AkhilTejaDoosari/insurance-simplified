import { describe, expect, it } from "vitest";
import { documentUrl } from "@/app/lib/document-url";

describe("documentUrl", () => {
  it("ends the path with the filename so the browser tab is named after it", () => {
    expect(documentUrl("sess-1", "doc-1", "plan-a.pdf", 3)).toBe(
      "/api/document/sess-1/doc-1/plan-a.pdf#page=3",
    );
  });
  it("encodes filenames and omits the fragment without a page", () => {
    expect(documentUrl("sess-1", "doc-2", "Patriot Travel #2 (2026).pdf")).toBe(
      "/api/document/sess-1/doc-2/Patriot%20Travel%20%232%20(2026).pdf",
    );
  });
});
