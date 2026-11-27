// Engine adapter (WP5): the web app's only route to the Python engine.
// Server-side only. Enabled when ENGINE_URL and ENGINE_SERVICE_TOKEN are set.
// The engine returns contract facts; this module maps them onto the existing
// comparison table so the same server-side verification, sealing and render
// gates (extract route) still decide what the user sees.

import type { SessionDocument } from "@/app/lib/session";
import type { ComparisonTable, TableRow, CellValue } from "@/app/lib/extraction/types";
import type { Verdict } from "@/app/lib/verdicts";
import type { components } from "@/app/lib/engine/contract.gen";

type Extraction = components["schemas"]["Extraction"];
type EngineFact = components["schemas"]["Fact"];

const TIMEOUT_MS = 180_000;

export class EngineError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`engine ${status} ${code}`);
  }
}

export function isEngineConfigured(): boolean {
  return Boolean(process.env.ENGINE_URL && process.env.ENGINE_SERVICE_TOKEN);
}

/** Engine fact state -> comparison verdict. Only both-keys facts are SUPPORTED;
 *  `not_covered` stays NEEDS VERIFICATION until the owner decides its verdict. */
export function verdictFor(state: EngineFact["state"]): Verdict {
  switch (state) {
    case "verified":
      return "SUPPORTED";
    case "conflicting":
      return "CONFLICTED";
    default:
      return "NEEDS VERIFICATION";
  }
}

export async function callEngine(pdf: Uint8Array, planId: string): Promise<Extraction> {
  const base = (process.env.ENGINE_URL ?? "").replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/extract?plan_id=${encodeURIComponent(planId)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.ENGINE_SERVICE_TOKEN ?? ""}`,
      "content-type": "application/pdf",
    },
    body: new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    let code = "ENGINE_ERROR";
    try {
      code = ((await res.json()) as { detail?: { code?: string } }).detail?.code ?? code;
    } catch {
      /* body is not JSON: keep the generic code; never echo it */
    }
    throw new EngineError(res.status, code);
  }
  return (await res.json()) as Extraction;
}

/** Map one engine extraction per document onto comparison rows. A fact without
 *  printed evidence is not shown as a value (the user is sent to its page by
 *  the engine's open items instead). Quotes are the engine's exact printed words. */
export function toComparisonTable(
  documents: SessionDocument[],
  extractions: Map<string, Extraction>,
): ComparisonTable {
  const rows = new Map<string, { verdicts: Verdict[]; values: CellValue[] }>();
  for (const doc of documents) {
    const ex = extractions.get(doc.documentId);
    if (!ex) continue;
    for (const fact of ex.facts) {
      const printed = ex.printed?.[fact.id];
      const ev = fact.evidence?.[0];
      if (!printed || !ev) continue;
      const quote = printed.text;
      // The row is the printed label plus its printed column, so one document's
      // in- and out-of-network cells stay apart without interpreting either.
      const column = printed.column_header ?? "";
      const name = column && column !== "Answers" ? `${fact.benefit_label} — ${column}` : fact.benefit_label;
      const row = rows.get(name) ?? { verdicts: [], values: [] };
      row.verdicts.push(verdictFor(fact.state));
      row.values.push({
        documentId: doc.documentId,
        display: quote,
        qualifiers: {},
        evidence: [{ documentId: doc.documentId, page: ev.page, quote }],
      });
      rows.set(name, row);
    }
  }
  const tableRows: TableRow[] = [...rows].map(([factName, r]) => ({
    factName,
    verdict: r.verdicts.every((v) => v === "SUPPORTED")
      ? "SUPPORTED"
      : r.verdicts.includes("CONFLICTED")
        ? "CONFLICTED"
        : "NEEDS VERIFICATION",
    values: r.values,
  }));
  return {
    schemaVersion: "v1",
    factListVersion: "engine-v1",
    documents: documents.map((d) => ({
      documentId: d.documentId,
      filename: d.filename,
      pageCount: d.pageCount,
    })),
    rows: tableRows,
  };
}

export async function extractViaEngine(
  documents: SessionDocument[],
  readPdf: (documentId: string) => Uint8Array | undefined,
): Promise<ComparisonTable> {
  const extractions = new Map<string, Extraction>();
  for (const doc of documents) {
    const pdf = readPdf(doc.documentId);
    if (!pdf) throw new EngineError(0, "PDF_NOT_AVAILABLE");
    extractions.set(doc.documentId, await callEngine(pdf, doc.documentId));
  }
  return toComparisonTable(documents, extractions);
}
