// Engine adapter (WP5): the web app's only route to the Python engine.
// Server-side only. Enabled when ENGINE_URL and ENGINE_SERVICE_TOKEN are set.
// The engine returns contract facts; this module maps them onto the existing
// comparison table so the same server-side verification, sealing and render
// gates (extract route) still decide what the user sees.

import type { SessionDocument } from "@/app/lib/session";
import type { ComparisonTable, TableRow, CellValue } from "@/app/lib/extraction/types";
import type { Verdict } from "@/app/lib/verdicts";
import type { components } from "@/app/lib/engine/contract.gen";
import { EngineError, ENGINE_READ_TIMEOUT_MS, postToEngine } from "@/app/lib/engine/http";

type Extraction = components["schemas"]["Extraction"];
type EngineFact = components["schemas"]["Fact"];
export type EngineValue = components["schemas"]["FactValue"];
export type EngineCategory = components["schemas"]["CategoryInfo"];

/** Options for one engine read. `cloudConsent`: the user agreed, for this request, that
 *  Claude may read the pages the engine's own readers can't settle and that Claude and GPT
 *  may check the values found (the second key). It is relayed to the
 *  engine, which still applies its own cloud policy (it is never enough on its own). */
export interface EngineOptions {
  cloudConsent?: boolean;
}

export { EngineError, ENGINE_LIMIT_S, ENGINE_READ_TIMEOUT_MS } from "@/app/lib/engine/http";

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

export async function callEngine(
  pdf: Uint8Array,
  planId: string,
  options: EngineOptions = {},
): Promise<Extraction> {
  const base = (process.env.ENGINE_URL ?? "").replace(/\/+$/, "");
  // explicit deadline matching the engine's own limit (fetch would give up at 300 s)
  const res = await postToEngine(`${base}/v1/extract?plan_id=${encodeURIComponent(planId)}`, {
    headers: {
      authorization: `Bearer ${process.env.ENGINE_SERVICE_TOKEN ?? ""}`,
      "content-type": "application/pdf",
      // Claude reads and judges; GPT judges only what Claude proposed (D-034 key 2)
      ...(options.cloudConsent ? { "x-engine-cloud-consent": "anthropic, openai" } : {}),
    },
    body: pdf,
    timeoutMs: ENGINE_READ_TIMEOUT_MS,
  });
  const ok = res.status >= 200 && res.status < 300;
  if (!ok) {
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

/** One engine fact as the V2 results screen shows it: the printed label and
 *  column, the state, the exact printed words and their page. Nothing here is
 *  interpreted; `evidenceId` is added by the route when it registers the quote. */
export interface V2Fact {
  id: string;
  label: string;
  column: string;
  state: EngineFact["state"];
  quote: string;
  page: number;
  /** Dictionary category (synonym match in the engine), or null: a plan-specific row. */
  categoryKey: string | null;
  /** The engine's code reading of the value - present only when both keys passed. */
  value: EngineValue | null;
  /** One plain-words line, written only from the printed label and quote - VERIFIED only. */
  plain: string;
  evidenceId?: string;
}

export interface V2Document {
  documentId: string;
  filename: string;
  pages: number;
  facts: V2Fact[];
  /** Printed lines the engine could not settle: "check page N". */
  openItems: { page: number; state: string; line: string }[];
  /** The engine's category dictionary (used only to match wording and order rows). */
  categories: EngineCategory[];
  /** Categories with no fact here: first page printing their wording, or null. */
  categorySearch: Record<string, number | null>;
  /** Some checks the user consented to couldn't run (a provider refused, timed out or a
   *  cap was reached): what wasn't checked shows as "couldn't confirm" with its page. */
  checksIncomplete: boolean;
}

export function toV2Documents(
  documents: SessionDocument[],
  extractions: Map<string, Extraction>,
): V2Document[] {
  return documents.flatMap((doc) => {
    const ex = extractions.get(doc.documentId);
    if (!ex) return [];
    const facts: V2Fact[] = [];
    for (const fact of ex.facts) {
      const printed = ex.printed?.[fact.id];
      const ev = fact.evidence?.[0];
      if (!printed || !ev) continue;
      facts.push({
        id: fact.id,
        label: fact.benefit_label,
        column: printed.column_header ?? "",
        state: fact.state,
        quote: printed.text,
        page: ev.page,
        categoryKey: fact.category_key ?? null,
        value: fact.state === "verified" && fact.value ? fact.value : null,
        plain: fact.state === "verified" ? (ex.plain?.[fact.id] ?? "") : "",
      });
    }
    return [
      {
        documentId: doc.documentId,
        filename: doc.filename,
        pages: ex.pages,
        facts,
        openItems: (ex.open_items ?? []).map((i) => ({
          page: i.page,
          state: i.state,
          line: i.line ?? "",
        })),
        categories: ex.categories ?? [],
        categorySearch: (ex.category_search ?? {}) as Record<string, number | null>,
        checksIncomplete: ex.checks_incomplete === true,
      },
    ];
  });
}

export interface EngineRun {
  table: ComparisonTable;
  documents: V2Document[];
}

export async function runEngine(
  documents: SessionDocument[],
  readPdf: (documentId: string) => Uint8Array | undefined,
  options: EngineOptions = {},
): Promise<EngineRun> {
  const extractions = new Map<string, Extraction>();
  const pdfs = documents.map((doc) => {
    const pdf = readPdf(doc.documentId);
    if (!pdf) throw new EngineError(0, "PDF_NOT_AVAILABLE");
    return pdf;
  });
  // at most 5 documents per session: read them at the same time (model calls wait on
  // the provider), each under its own per-document cost cap in the engine
  const results = await Promise.all(documents.map((doc, i) => callEngine(pdfs[i], doc.documentId, options)));
  documents.forEach((doc, i) => extractions.set(doc.documentId, results[i]));
  return {
    table: toComparisonTable(documents, extractions),
    documents: toV2Documents(documents, extractions),
  };
}

export async function extractViaEngine(
  documents: SessionDocument[],
  readPdf: (documentId: string) => Uint8Array | undefined,
): Promise<ComparisonTable> {
  return (await runEngine(documents, readPdf)).table;
}
