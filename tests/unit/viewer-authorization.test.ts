// Citation viewer authorization. The rendered page and its metadata must not
// reveal filenames, page counts, cited passages or document links unless the
// request carries THIS session's capability — whether the session is in the
// instance cache or restored from durable state.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let cookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "sid_cap" && cookieValue ? { name, value: cookieValue } : undefined) }),
}));
vi.mock("@/app/components/PdfEvidenceViewer", () => ({
  default: (p: { pdfUrl: string; quote: string | null }) => createElement("div", { "data-pdf": p.pdfUrl }, p.quote ?? ""),
}));
vi.mock("@/app/lib/session-store", async (orig) => {
  const actual = await orig<typeof import("@/app/lib/session-store")>();
  return { ...actual, loadSession: vi.fn(actual.loadSession) };
});

import { createSession, deleteSession, registerEvidence } from "@/app/lib/session";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import { loadSession } from "@/app/lib/session-store";
// The page is TSX compiled with the classic runtime in this harness.
(globalThis as { React?: unknown }).React = React;
const { default: CitationViewer, generateMetadata } = await import("@/app/view/[sessionId]/[documentId]/[filename]/page");

const SECRET_FILE = "acme-confidential-plan.pdf";
const QUOTE = "Annual deductible: $250 secret wording";
const created: { id: string; cap: string }[] = [];

function makeSession(file = SECRET_FILE, quote = QUOTE) {
  const { session, capability } = createSession(
    [{ documentId: "doc-1", filename: file, pageCount: 2, pages: [quote, "page two"] }], {},
  );
  registerEvidence(session.sessionId, [{ documentId: "doc-1", page: 1, quote }]);
  created.push({ id: session.sessionId, cap: capability });
  return { id: session.sessionId, cap: capability, ev: evidenceIdFor("doc-1", 1, quote) };
}

async function render(sessionId: string, evidence: string, page = "1", documentId = "doc-1") {
  const props = {
    params: Promise.resolve({ sessionId, documentId, filename: "url-supplied-name.pdf" }),
    searchParams: Promise.resolve({ page, evidence }),
  };
  const html = renderToStaticMarkup(await CitationViewer(props));
  const meta = await generateMetadata({ params: props.params, searchParams: props.searchParams });
  return { html, title: String(meta.title) };
}

const leaks = (html: string, title: string) =>
  [SECRET_FILE, QUOTE, "of 2", "/api/document/"].filter((s) => html.includes(s) || title.includes(s));

beforeEach(() => { cookieValue = undefined; vi.mocked(loadSession).mockClear(); });
afterEach(() => { for (const s of created.splice(0)) deleteSession(s.id); });

describe("citation viewer authorization (cache hit)", () => {
  it("missing capability reveals nothing", async () => {
    const a = makeSession();
    const { html, title } = await render(a.id, a.ev);
    expect(leaks(html, title)).toEqual([]);
    expect(html).toContain("Citation unavailable");
  });

  it("invalid capability reveals nothing", async () => {
    const a = makeSession();
    cookieValue = "not-the-capability";
    const { html, title } = await render(a.id, a.ev);
    expect(leaks(html, title)).toEqual([]);
  });

  it("session B's capability does not open session A", async () => {
    const a = makeSession();
    const b = makeSession("other.pdf", "Other wording");
    cookieValue = b.cap;
    const { html, title } = await render(a.id, a.ev);
    expect(leaks(html, title)).toEqual([]);
  });

  it("an unauthorized request cannot probe documents or page counts", async () => {
    const a = makeSession();
    const unknownDoc = await render(a.id, a.ev, "1", "doc-9");
    const badPage = await render(a.id, a.ev, "99");
    const noSession = await render("sess-does-not-exist", a.ev);
    expect(unknownDoc.html).toBe(noSession.html);
    expect(badPage.html).toBe(noSession.html);
  });

  it("the correct capability shows the document, page and cited passage", async () => {
    const a = makeSession();
    cookieValue = a.cap;
    const { html, title } = await render(a.id, a.ev);
    expect(html).toContain(SECRET_FILE);
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain(QUOTE);
    expect(title).toContain(SECRET_FILE);
  });
});

describe("citation viewer authorization (cache miss / durable restore)", () => {
  it("never reads durable state without a valid capability", async () => {
    await render("sess-not-cached-xyz", "ev-0000000000000000");
    cookieValue = "forged";
    await render("sess-not-cached-xyz", "ev-0000000000000000");
    expect(loadSession).not.toHaveBeenCalled();
  });

  it("a restored session is shown only to its capability holder", async () => {
    const a = makeSession();
    // Simulate the restored session being served by the loader.
    cookieValue = "forged";
    expect(leaks(...Object.values(await render(a.id, a.ev)) as [string, string])).toEqual([]);
    cookieValue = a.cap;
    const ok = await render(a.id, a.ev);
    expect(ok.html).toContain(QUOTE);
    expect(loadSession).toHaveBeenCalledWith(a.id);
  });
});
