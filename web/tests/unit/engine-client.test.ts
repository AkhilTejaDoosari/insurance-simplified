import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EngineError,
  extractViaEngine,
  isEngineConfigured,
  verdictFor,
} from "@/app/lib/engine/client";
import { validateTable } from "@/app/lib/extraction/types";
import type { SessionDocument } from "@/app/lib/session";

const SHA = "a".repeat(64);

function fact(id: string, label: string, state: string, page = 2) {
  return {
    id,
    plan_id: "doc-1",
    benefit_label: label,
    state,
    value: null,
    evidence: [{ document_sha256: SHA, page, value_span: { start: 0, end: 5 } }],
    provenance: { parser: { name: "opendataloader", version: "t" }, created_at: "2026-11-27T00:00:00Z" },
    check_page: page,
  };
}

const doc = { documentId: "doc-1", filename: "plan.pdf", pageCount: 3 } as SessionDocument;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("engine client", () => {
  it("is off unless both the URL and the service token are set", () => {
    vi.stubEnv("ENGINE_URL", "http://engine:8000");
    vi.stubEnv("ENGINE_SERVICE_TOKEN", "");
    expect(isEngineConfigured()).toBe(false);
    vi.stubEnv("ENGINE_SERVICE_TOKEN", "t");
    expect(isEngineConfigured()).toBe(true);
  });

  it("only both-keys facts are SUPPORTED; everything else needs verification", () => {
    expect(verdictFor("verified")).toBe("SUPPORTED");
    expect(verdictFor("couldnt_confirm")).toBe("NEEDS VERIFICATION");
    expect(verdictFor("not_covered")).toBe("NEEDS VERIFICATION");
    expect(verdictFor("conflicting")).toBe("CONFLICTED");
  });

  it("sends the PDF with the service token and maps printed quotes onto rows", async () => {
    vi.stubEnv("ENGINE_URL", "http://engine:8000/");
    vi.stubEnv("ENGINE_SERVICE_TOKEN", "secret-t");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          document_sha256: SHA,
          pages: 3,
          parser: { name: "opendataloader", version: "t" },
          facts: [
            fact("f1", "Specialist visit", "couldnt_confirm"),
            fact("f2", "Urgent care", "verified"),
            { ...fact("f3", "Unread line", "couldnt_confirm"), evidence: [] },
          ],
          printed: {
            f1: { text: "$45 copay/visit", column_header: "In-Network" },
            f2: { text: "$90 copay/visit", column_header: "" },
          },
          open_items: [],
          model_calls: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const table = await extractViaEngine([doc], () => new Uint8Array([37, 80, 68, 70]));
    expect(calls[0].url).toBe("http://engine:8000/v1/extract?plan_id=doc-1");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer secret-t");
    expect(validateTable(table)).toBeTruthy();
    const byName = Object.fromEntries(table.rows.map((r) => [r.factName, r]));
    expect(byName["Specialist visit — In-Network"].verdict).toBe("NEEDS VERIFICATION");
    expect(byName["Urgent care"].verdict).toBe("SUPPORTED");
    expect(byName["Urgent care"].values[0].evidence[0]).toEqual({
      documentId: "doc-1",
      page: 2,
      quote: "$90 copay/visit",
    });
    expect(byName["Unread line"]).toBeUndefined(); // no printed evidence -> no value shown
  });

  it("reports the engine's error code, never its body", async () => {
    vi.stubEnv("ENGINE_URL", "http://engine:8000");
    vi.stubEnv("ENGINE_SERVICE_TOKEN", "t");
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ detail: { code: "UNREADABLE_PDF" } }), { status: 422 }),
    );
    await expect(extractViaEngine([doc], () => new Uint8Array([1]))).rejects.toEqual(
      new EngineError(422, "UNREADABLE_PDF"),
    );
    await expect(extractViaEngine([doc], () => undefined)).rejects.toBeInstanceOf(EngineError);
  });
});
