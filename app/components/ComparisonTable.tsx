"use client";

import type {
  CellValue,
  ComparisonTable as Table,
} from "@/app/lib/extraction/types";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { groupRows } from "@/app/lib/extraction/sections";
import VerdictBadge from "@/app/components/VerdictBadge";

export interface SelectedCell {
  factName: string;
  verdict: string;
  values: CellValue[];
}

const LABELS = new Map(FACTS.map((f) => [f.name, f.label]));

export default function ComparisonTable({
  table,
  onSelectCell,
}: {
  table: Table;
  onSelectCell: (cell: SelectedCell) => void;
}) {
  const groups = groupRows(table.rows);
  const columns = table.documents.length + 2;

  return (
    <section className="card comparison" aria-label="Plan comparison">
      <div className="comparison__intro">
        <h2>Your plans, side by side</h2>
        <p>Select any value to see the exact wording it came from.</p>
      </div>
      <table className="table">
        <colgroup>
          <col className="col-fact" />
          <col className="col-verdict" />
          {table.documents.map((d) => (
            <col key={d.documentId} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Fact</th>
            <th scope="col">Verdict</th>
            {table.documents.map((d) => (
              <th key={d.documentId} scope="col">
                {d.filename}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map(({ section, rows }) => (
          <tbody key={section.title}>
            <tr className="table__section">
              <th scope="colgroup" colSpan={columns}>
                <h3>{section.title}</h3>
                <p>{section.description}</p>
              </th>
            </tr>
            {rows.map((row) => (
              <tr key={row.factName}>
                <th scope="row" className="table__fact">
                  {LABELS.get(row.factName) ?? row.factName}
                </th>
                <td>
                  <VerdictBadge verdict={row.verdict} />
                  {row.verdict === "DOES NOT APPEAR TO FIT" && row.rationale ? (
                    <span className="table__rationale">{row.rationale}</span>
                  ) : null}
                </td>
                {table.documents.map((d) => {
                  const value = row.values.find(
                    (v) => v.documentId === d.documentId,
                  );
                  return (
                    <td key={d.documentId}>
                      {value ? (
                        <button
                          className="cell-value"
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
                        <span className="table__empty" aria-label="Not found">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}
