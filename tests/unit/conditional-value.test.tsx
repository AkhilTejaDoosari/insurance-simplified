import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import ConditionalValue from "@/app/components/ConditionalValue";
import ComparisonTable from "@/app/components/ComparisonTable";
import { documentUrl } from "@/app/lib/document-url";
import { evidenceIdFor } from "@/app/lib/evidence-ids";
import type {
  Qualifiers,
  RegisteredCellValue,
  RegisteredComparisonTable as Table,
} from "@/app/lib/extraction/types";

/** V1.1 M2 task 6: a material number renders with the conditions needed to
 *  understand it beside the value, an unresolved relation asks a question
 *  instead of guessing, and every value keeps its original-page citation. */

const QUOTE = "Coinsurance: you pay 10% in-network and 20% out-of-network.";

function value(
  display: string,
  qualifiers: Qualifiers,
  quote: string,
  page = 1,
): RegisteredCellValue {
  return {
    documentId: "doc-1",
    display,
    qualifiers,
    evidence: [
      { documentId: "doc-1", page, quote, evidenceId: evidenceIdFor("doc-1", page, quote) },
    ],
  };
}

const DOC_NAME = "plan-a.pdf";

function render(v: RegisteredCellValue, userContext?: Record<string, string>): string {
  return renderToStaticMarkup(
    React.createElement(ConditionalValue, {
      value: v,
      factLabel: "Coinsurance",
      documentName: DOC_NAME,
      sessionId: "sess-1",
      userContext,
    }),
  );
}

function table(
  row: Pick<Table, "rows">["rows"][number],
  userContext?: Record<string, string>,
): string {
  return renderToStaticMarkup(
    React.createElement(ComparisonTable, {
      table: {
        schemaVersion: "v1",
        factListVersion: "v1",
        documents: [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 }],
        rows: [row],
      } satisfies Table,
      sessionId: "sess-1",
      userContext,
    }),
  );
}

describe("ConditionalValue condition notes", () => {
  it("puts the network condition beside each percentage", () => {
    const out = render(value("10% / 20%", { networkTier: "in-network" }, QUOTE));
    expect(out).toMatch(/10% in-network/);
    expect(out).toMatch(/20% out-of-network/);
    expect(out).toContain("10% / 20%");
    expect(out).not.toContain("Unresolved");
  });

  it("keeps a qualifying network visible when the network row is summarized", () => {
    const out = table({
      factName: "network",
      verdict: "SUPPORTED",
      values: [
        value(
          "UnitedHealthcare PPO — in-network 90% / out-of-network 70%",
          { networkTier: "in-network" },
          "UnitedHealthcare PPO network: in-network 90% / out-of-network 70%.",
        ),
      ],
    });
    // Concise identity replaces the long display…
    expect(out).toContain("UnitedHealthcare PPO");
    // …but plain UI text must never silently drop the network condition.
    expect(out).toContain("90% in-network");
    expect(out).toContain("70% out-of-network");
  });

  it("labels an undetermined purchase as unknown, never as chosen", () => {
    const out = render(value("$0 / $500 / $0", { networkTier: "in-network" }, QUOTE));
    expect(out).toContain("purchased option is unknown");
    expect(out).not.toContain("Purchased option stated");
  });

  it("shows a purchased option only when the source attests it", () => {
    const out = render(
      value("$500", { selectionStatus: "purchased" }, "You selected the $500 annual deductible."),
    );
    expect(out).toContain("Purchased option stated by the source");
  });

  it("keeps every age band visible while marking the one matching the user", () => {
    const out = table(
      {
        factName: "premium",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            display: "$1,200",
            qualifiers: { ageBand: "25-29", ageMin: 25, ageMax: 29, period: "per year" },
            evidence: [
              {
                documentId: "doc-1",
                page: 1,
                quote: "Ages 25-29: $1,200 per year.",
                evidenceId: evidenceIdFor("doc-1", 1, "Ages 25-29: $1,200 per year."),
              },
            ],
          },
          {
            documentId: "doc-1",
            display: "$2,400",
            qualifiers: { ageBand: "60-64", ageMin: 60, ageMax: 64, period: "per year" },
            evidence: [
              {
                documentId: "doc-1",
                page: 1,
                quote: "Ages 60-64: $2,400 per year.",
                evidenceId: evidenceIdFor("doc-1", 1, "Ages 60-64: $2,400 per year."),
              },
            ],
          },
        ],
      },
      { age: "25" },
    );
    expect(out).toContain("Ages: 25-29");
    expect(out).toContain("Ages: 60-64");
    expect(out).toContain("matches your age 25");
    expect(out.match(/class="cell-value"/g)).toHaveLength(2);
    // No band is dropped, and only one is marked as matching.
    expect(out.match(/cell-condition--match/g)).toHaveLength(1);
  });

  it("keeps the original-page citation identity on the value", () => {
    const quote = "Coinsurance: 90% in-network.";
    const out = render(value("90%", { networkTier: "in-network" }, quote, 2));
    const expected = documentUrl(
      "sess-1",
      "doc-1",
      DOC_NAME,
      2,
      evidenceIdFor("doc-1", 2, quote),
    );
    expect(out).toContain(`href="${expected.replace(/&/g, "&amp;")}"`);
    expect(out).toContain(
      `aria-label="View source evidence for Coinsurance — ${DOC_NAME}, page 2"`,
    );
    expect(out).toContain('target="_blank"');
  });

  it("asks which amount applies when nothing identifies the figures", () => {
    const out = render(value("$0 / $500 / $0", {}, "Out-of-pocket maximum: $0 / $500 / $0."));
    expect(out).toContain("cell-condition--question");
    expect(out).toMatch(/which amount applies/i);
  });

  it("does not question a scope-labelled multi-amount value", () => {
    const out = render(
      value(
        "$250 in-network / $500 out-of-network",
        { networkTier: "in-network" },
        "Annual deductible: $250 in-network / $500 out-of-network.",
      ),
    );
    expect(out).not.toContain("cell-condition--question");
  });

  it("asks for the relationship when one network label cannot explain all three percentages", () => {
    const out = render(value("100% / 90% / 100%", { networkTier: "in-network" },
      "Coinsurance: 100% / 90% / 100% in-network."));
    expect(out).toMatch(/which amount applies/i);
    expect(out).not.toContain("Network: in-network");
  });

  it("renders the actual mixed network percentages with an unresolved verification question and source link", () => {
    const quote = "Coinsurance: 100% in-network / 90% / 100% out-of-network.";
    const out = render(value("100% in-network / 90% / 100% out-of-network",
      { networkTier: "in-network" }, quote, 2));
    expect(out).toContain("90%");
    expect(out).toMatch(/Unresolved:.*[Cc]onfirm.*source page/);
    expect(out).toContain(`evidence=${evidenceIdFor("doc-1", 2, quote)}`);
    expect(out).not.toContain("90% in-network");
    expect(out).not.toContain("90% out-of-network");
  });

  it("does not assign a network to repeated percentages because unrelated selected services are mentioned", () => {
    const quote = "Selected services coinsurance: 100% in-network / 90% / 100% out-of-network.";
    const out = render(value("100% / 90% / 100%", { networkTier: "in-network" }, quote, 2));
    expect(out).toContain("100% / 90% / 100%");
    expect(out).toContain("cell-condition--question");
    expect(out).not.toContain("Network: in-network");
    expect(out).toContain(`evidence=${evidenceIdFor("doc-1", 2, quote)}`);
  });

  it("does not render an unsupported material qualifier as a sourced condition", () => {
    const quote = "Annual deductible: $250.";
    const out = render(value("$250", {
      networkTier: "Preferred PPO", ageBand: "25-29", frequency: "monthly", currency: "EUR",
    }, quote));
    expect(out).not.toMatch(/Network:|Ages:|Billed|Currency:/);
    expect(out).toContain(`evidence=${evidenceIdFor("doc-1", 1, quote)}`);
    expect(out).toContain("$250");
  });

  it("does not relabel identical percentages with the first network's scope", () => {
    const quote = "Coinsurance: 100% in-network / 100% out-of-network.";
    const out = render(value("100% / 100%", { networkTier: "in-network / out-of-network" }, quote));
    expect(out).toContain("100% in-network");
    expect(out).toContain("100% out-of-network");
  });

  it("renders all ambiguous copay figures and the uncertainty beside a verified source link", () => {
    const quote = "Emergency room copay: $100 in-network / $200 / $300 out-of-network.";
    const out = render(value(quote, { networkTier: "in-network" }, quote));
    expect(out).toMatch(/\$100.*\$200.*\$300/);
    expect(out).toContain("cell-condition--question");
    expect(out).toContain(`evidence=${evidenceIdFor("doc-1", 1, quote)}`);
  });

  it("puts longer source conditions behind compact disclosure", () => {
    const conditions =
      "Covered after the deductible is met, subject to prior authorization and network acceptance";
    const out = render(
      value("90%", { networkTier: "in-network", conditions }, `Plan pays 90% in-network, ${conditions.toLowerCase()}`),
    );
    expect(out).toContain("Network: in-network");
    expect(out).toContain("<details");
    expect(out).toContain("<summary>Conditions</summary>");
    expect(out).toContain(conditions);
  });

  it("preserves Not stated semantics for empty cells", () => {
    const out = table({ factName: "annual-deductible", verdict: "NOT STATED", values: [] });
    expect(out).toContain('aria-label="Not stated"');
  });
});

describe("verified plan isolation in the rendered comparison", () => {
  const planValue = (planId: string, name: string, amount: string, page: number): RegisteredCellValue => {
    const quote = `Plan name: ${name}; annual-deductible: ${amount}`;
    return { ...value(amount, {}, quote, page), planId };
  };
  const planTable = (values: RegisteredCellValue[], verdict: Table["rows"][number]["verdict"] = "SUPPORTED"): Table => ({
    schemaVersion: "v1", factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "brochure.pdf", pageCount: 2 }],
    plans: [
      { planId: "alpha", name: "Alpha", sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }] },
      { planId: "beta", name: "Beta", sources: [{ documentId: "doc-1", page: 2, quote: "Plan name: Beta" }] },
    ],
    rows: [{ factName: "annual-deductible", verdict, values }],
  });
  const rendered = (t: Table) => renderToStaticMarkup(React.createElement(ComparisonTable, {
    table: t, sessionId: "sess-1", selectedSection: "My Costs",
  }));

  it("shows two verified plans in separate columns without sharing either value", () => {
    const out = rendered(planTable([
      planValue("alpha", "Alpha", "$250", 1), planValue("beta", "Beta", "$500", 2),
    ]));
    expect(out).toMatch(/<th[^>]*>.*Alpha.*<\/th>/);
    expect(out).toMatch(/<th[^>]*>.*Beta.*<\/th>/);
    const row = out.match(/<tr[^>]*><th scope="row"[^>]*>Annual deductible[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = row.match(/<td\b[\s\S]*?<\/td>/g) ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toContain("$250");
    expect(cells[0]).not.toContain("$500");
    expect(cells[1]).toContain("$500");
    expect(cells[1]).not.toContain("$250");
  });

  it("shows a same-plan same-scope contradiction with both verified citations", () => {
    const out = rendered(planTable([
      planValue("alpha", "Alpha", "$250", 1), planValue("alpha", "Alpha", "$500", 2),
      planValue("beta", "Beta", "$750", 2),
    ]));
    const row = out.match(/<tr[^>]*><th scope="row"[^>]*>Annual deductible[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = row.match(/<td\b[\s\S]*?<\/td>/g) ?? [];
    expect(cells[0]).toMatch(/CONFLICTED|Conflicting evidence/);
    expect(cells[0]).toContain("$250");
    expect(cells[0]).toContain("$500");
    expect(cells[0]).toContain("page=1");
    expect(cells[0]).toContain("page=2");
    expect(cells[1]).not.toMatch(/CONFLICTED|Conflicting evidence/);
  });

  it("keeps tiers of two verified plans in separate columns with tier labels inside each plan column", () => {
    const values = [
      { ...planValue("alpha", "Alpha", "$250", 1), qualifiers: { planTier: "Lite" } },
      { ...planValue("alpha", "Alpha", "$500", 1), qualifiers: { planTier: "Gold" } },
      { ...planValue("beta", "Beta", "$750", 2), qualifiers: { planTier: "Lite" } },
      { ...planValue("beta", "Beta", "$900", 2), qualifiers: { planTier: "Gold" } },
    ];
    const out = rendered(planTable(values));
    const row = out.match(/<tr[^>]*><th scope="row"[^>]*>Annual deductible[\s\S]*?<\/tr>/)?.[0] ?? "";
    const cells = row.match(/<td\b[\s\S]*?<\/td>/g) ?? [];
    // V1.1: one column per plan, tier values labeled inside.
    expect(cells).toHaveLength(2);
    expect(cells[0]).toContain("$250");
    expect(cells[0]).toContain("$500");
    expect(cells[1]).toContain("$750");
    expect(cells[1]).toContain("$900");
  });
});
