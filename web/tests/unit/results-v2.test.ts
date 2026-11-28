import { describe, expect, it } from "vitest";
import { buildRows } from "@/app/components/ResultsV2";
import { toV2Documents } from "@/app/lib/engine/client";
import type { V2Document } from "@/app/lib/engine/client";
import type { SessionDocument } from "@/app/lib/session";

const fact = (label: string, column: string, quote: string, state = "couldnt_confirm") =>
  ({ label, column, state, quote, page: 1 }) as V2Document["facts"][number];

describe("V2 results rows", () => {
  it("groups the same printed label and column across documents, keeps columns apart", () => {
    const docs: V2Document[] = [
      { documentId: "a", filename: "a.pdf", pages: 1, openItems: [], facts: [fact("Specialist visit", "In-Network", "$45"), fact("Specialist visit", "Out-of-Network", "50%")] },
      { documentId: "b", filename: "b.pdf", pages: 1, openItems: [], facts: [fact("specialist  visit", "in-network", "$30")] },
    ];
    const rows = buildRows(docs);
    const inNet = rows.find((r) => r.column === "In-Network")!;
    expect([...inNet.cells.keys()]).toEqual(["a", "b"]);
    expect(rows.find((r) => r.column === "Out-of-Network")!.cells.size).toBe(1);
  });

  it('treats the SBC "Answers" header as no column', () => {
    const rows = buildRows([
      { documentId: "a", filename: "a.pdf", pages: 1, openItems: [], facts: [fact("Is there a deductible?", "Answers", "$500")] },
    ]);
    expect(rows[0].column).toBe("");
  });
});

describe("toV2Documents", () => {
  it("keeps only facts with printed words and evidence; never a value", () => {
    const docs = [{ documentId: "d1", filename: "p.pdf", pageCount: 2 }] as SessionDocument[];
    const ex = {
      document_sha256: "a".repeat(64),
      pages: 2,
      parser: { name: "opendataloader", version: "t" },
      facts: [
        { id: "f1", benefit_label: "Urgent care", state: "couldnt_confirm", evidence: [{ page: 2 }] },
        { id: "f2", benefit_label: "Unread", state: "couldnt_confirm", evidence: [] },
      ],
      printed: { f1: { text: "$90 copay/visit", column_header: "In-Network" } },
      open_items: [{ page: 2, state: "not_extracted", line: "Hospital stay $500" }],
      model_calls: 0,
    };
    const [d] = toV2Documents(docs, new Map([["d1", ex as never]]));
    expect(d.facts).toEqual([
      { label: "Urgent care", column: "In-Network", state: "couldnt_confirm", quote: "$90 copay/visit", page: 2 },
    ]);
    expect(d.openItems).toEqual([{ page: 2, state: "not_extracted", line: "Hospital stay $500" }]);
  });
});
