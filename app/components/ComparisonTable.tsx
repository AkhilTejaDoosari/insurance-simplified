"use client";

import type {
  CellValue,
  ComparisonTable as Table,
} from "@/app/lib/extraction/types";

export interface SelectedCell {
  factName: string;
  verdict: string;
  values: CellValue[];
}

export default function ComparisonTable({
  table,
  onSelectCell,
}: {
  table: Table;
  onSelectCell: (cell: SelectedCell) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Fact</th>
          <th>Verdict</th>
          {table.documents.map((d) => (
            <th key={d.documentId}>{d.filename}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.factName}>
            <td>{row.factName}</td>
            <td>
              {row.verdict}
              {row.verdict === "DOES NOT APPEAR TO FIT" && row.rationale
                ? ` — ${row.rationale}`
                : null}
            </td>
            {table.documents.map((d) => {
              const value = row.values.find((v) => v.documentId === d.documentId);
              return (
                <td key={d.documentId}>
                  {value ? (
                    <button
                      onClick={() =>
                        onSelectCell({
                          factName: row.factName,
                          verdict: row.verdict,
                          values: row.values,
                        })
                      }
                      title="Show source evidence"
                    >
                      {value.display}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
