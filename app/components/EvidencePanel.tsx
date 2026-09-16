"use client";

import type { SelectedCell } from "@/app/components/ComparisonTable";

export default function EvidencePanel({ cell }: { cell: SelectedCell | null }) {
  if (!cell) return <aside aria-label="Evidence">Select a cell to see its source.</aside>;
  return (
    <aside aria-label="Evidence">
      <h3>
        {cell.factName} — {cell.verdict}
      </h3>
      {cell.values.map((v) => (
        <div key={v.documentId}>
          <h4>{v.documentId}</h4>
          <p>{v.display}</p>
          {v.evidence.map((e, i) => (
            <blockquote key={i}>
              <p>{e.quote}</p>
              <cite>
                {e.documentId}, page {e.page}
              </cite>
            </blockquote>
          ))}
        </div>
      ))}
    </aside>
  );
}
