"use client";

import type { SelectedCell } from "@/app/components/ComparisonTable";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { documentUrl } from "@/app/lib/document-url";
import { isVerdict } from "@/app/lib/verdicts";
import VerdictBadge from "@/app/components/VerdictBadge";

const LABELS = new Map(FACTS.map((f) => [f.name, f.label]));

export default function EvidencePanel({
  cell,
  sessionId,
  documents,
}: {
  cell: SelectedCell | null;
  sessionId: string;
  documents: { documentId: string; filename: string }[];
}) {
  const filename = (documentId: string) =>
    documents.find((d) => d.documentId === documentId)?.filename ?? documentId;

  if (!cell) {
    return (
      <aside className="panel" aria-label="Evidence">
        <h2>Evidence</h2>
        <p className="text-muted">
          Select a value in the table to see the exact wording it came from.
        </p>
      </aside>
    );
  }
  return (
    <aside className="panel" aria-label="Evidence">
      <h2>{LABELS.get(cell.factName) ?? cell.factName}</h2>
      <p className="evidence__value">
        {isVerdict(cell.verdict) ? (
          <VerdictBadge verdict={cell.verdict} />
        ) : (
          cell.verdict
        )}
      </p>
      <div className="stack" style={{ marginTop: 16 }}>
        {cell.values.map((v, i) => (
          // A document contributes one value per tier, so documentId alone
          // is not a unique key.
          <div key={`${v.documentId}:${v.qualifiers.planTier ?? i}`} className="evidence__source">
            <h4>
              {filename(v.documentId)}
              {v.qualifiers.planTier ? ` — ${v.qualifiers.planTier}` : ""}
            </h4>
            <p className="evidence__value">{v.display}</p>
            {v.evidence.map((e, i) => (
              <blockquote key={i} className="quote">
                <p>{e.quote}</p>
                <cite>
                  {e.documentId},{" "}
                  <a
                    href={documentUrl(sessionId, e.documentId, filename(e.documentId), e.page)}
                    target="_blank"
                    rel="noopener"
                    title={`Open ${filename(e.documentId)} at page ${e.page}`}
                  >
                    page {e.page}
                  </a>
                </cite>
              </blockquote>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
