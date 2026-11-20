// P0-05 rendering regression: the result card, the reading brief and the PDF
// export lead with the short verified claim, list the conditions beside it,
// and keep the full verbatim source wording and its evidence link. Synthetic.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import ConditionalValue from "@/app/components/ConditionalValue";
import AdaptiveResults from "@/app/components/AdaptiveResults";
import { buildReportPdf } from "@/app/lib/report/pdf";
import type { RegisteredCellValue, RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
(globalThis as Record<string, unknown>).React ??= React;

const LABEL = "Walk-in Clinic • Referral required • Copayment: $40";
const HEADING = "In-Network Plan Pays";
const NOTE = "Outpatient services are limited to usual, reasonable and customary charges per period of coverage.";
const DISPLAY = `${LABEL} (${HEADING}): 90%\n${NOTE}`;
const CLAIM = "Walk-in Clinic (In-Network Plan Pays): 90%";

const VALUE: RegisteredCellValue = {
  documentId: "a",
  planId: "a",
  display: DISPLAY,
  qualifiers: { networkTier: "In-Network" },
  evidence: [
    { documentId: "a", page: 4, quote: `${LABEL} 90%`, evidenceId: "ev-row" },
    { documentId: "a", page: 4, quote: HEADING, evidenceId: "ev-head" },
    { documentId: "a", page: 4, quote: NOTE, evidenceId: "ev-note" },
  ],
  anchor: { kind: "table-cell", page: 4, table: 0, row: 2, column: 1, label: LABEL },
};

const TABLE: Table = {
  schemaVersion: "v1",
  factListVersion: "v2",
  documents: [{ documentId: "a", filename: "a.pdf", pageCount: 4 }],
  plans: [{ planId: "a", name: "Policy a", sources: [{ documentId: "a", page: 1, quote: "Policy a" }] }],
  rows: [{ factName: "urgent-care", verdict: "SUPPORTED", values: [VALUE] }],
};

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("claim-first presentation (P0-05)", () => {
  it("result value: the claim is the evidence link; conditions and full wording stay visible/available", () => {
    const html = renderToStaticMarkup(
      <ConditionalValue value={VALUE} factLabel="Urgent care" factName="urgent-care" documentName="a.pdf" sessionId="s" />,
    );
    const link = /<a class="cell-value"[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/.exec(html);
    expect(link?.[2]).toBe(CLAIM);
    expect(link?.[1]).toContain("ev-row");
    const conditions = /<ul class="cell-conditions"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
    expect(text(conditions)).toContain("Referral required");
    expect(text(conditions)).toContain("Copayment: $40");
    expect(text(conditions)).toContain(NOTE);
    const wording = /<details class="cell-detail"><summary>Source wording<\/summary>([\s\S]*?)<\/details>/.exec(html)?.[1] ?? "";
    expect(text(wording)).toContain(text(DISPLAY));
  });

  it("reading brief: the finding card leads with the claim, not the source paragraph", () => {
    const html = renderToStaticMarkup(
      <AdaptiveResults
        table={TABLE}
        view={{ mode: "understand", documentId: "a", planIds: ["a"], tiers: {} }}
        sessionId="s"
        userContext={{}}
        contacts={[]}
      />,
    );
    const links = [...html.matchAll(/<a class="cell-value"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l === CLAIM)).toBe(true);
  });

  it("PDF export: claim headline, each condition, then the source wording", async () => {
    const bytes = await buildReportPdf({
      table: TABLE,
      userContext: {},
      selection: { resultFingerprint: "fp", viewMode: "understand", documentId: "a", planIds: ["a"], tiers: {}, legacyTiersByDocument: {} },
    });
    const proxy = await getDocumentProxy(bytes);
    const result = await extractText(proxy, { mergePages: true });
    const pdf = String(result.text).replace(/\s+/g, " ");
    const claimAt = pdf.indexOf(`Policy a: ${CLAIM}`);
    expect(claimAt).toBeGreaterThanOrEqual(0);
    for (const condition of ["Referral required", "Copayment: $40", NOTE]) {
      expect(pdf.indexOf(condition, claimAt)).toBeGreaterThan(claimAt);
    }
    const wordingAt = pdf.indexOf("Source wording:", claimAt);
    expect(wordingAt).toBeGreaterThan(claimAt);
    expect(pdf.slice(wordingAt)).toContain(`${LABEL} (${HEADING}): 90%`);
  });

  it("PDF export: a value without a verified claim keeps its verbatim display and lists no split conditions", async () => {
    const unverified: RegisteredCellValue = {
      ...VALUE,
      evidence: VALUE.evidence.map((e) => (e.evidenceId === "ev-row" ? { ...e, quote: `${LABEL} 80%` } : e)),
    };
    const bytes = await buildReportPdf({
      table: { ...TABLE, rows: [{ factName: "urgent-care", verdict: "SUPPORTED", values: [unverified] }] },
      userContext: {},
      selection: { resultFingerprint: "fp", viewMode: "understand", documentId: "a", planIds: ["a"], tiers: {}, legacyTiersByDocument: {} },
    });
    const proxy = await getDocumentProxy(bytes);
    const pdf = String((await extractText(proxy, { mergePages: true })).text).replace(/\s+/g, " ");
    expect(pdf).not.toContain(CLAIM);
    expect(pdf).toContain(`(${HEADING}): 90%`);
    expect(pdf).not.toContain("Source wording:");
    expect(pdf).not.toContain("- Copayment: $40");
  });
});
