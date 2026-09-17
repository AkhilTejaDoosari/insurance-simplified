"use client";

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CellValue,
  ComparisonTable as Table,
  TableRow,
} from "@/app/lib/extraction/types";
import { FACTS } from "@/app/lib/extraction/fact-list";
import { groupRows } from "@/app/lib/extraction/sections";
import { cellValues, documentTiers } from "@/app/lib/extraction/tiers";
import VerdictBadge from "@/app/components/VerdictBadge";

export interface SelectedCell {
  factName: string;
  verdict: string;
  values: CellValue[];
}

const LABELS = new Map(FACTS.map((f) => [f.name, f.label]));
const ALL_TIERS = "__all__";

/** One document's slot in the header: single-tier docs get one column; a
 *  multi-tier doc gets one column per visible tier under a shared header. */
interface DocumentGroup {
  documentId: string;
  filename: string;
  tiers: string[];
  /** Tiers currently shown; undefined entries mean "the whole document". */
  visible: (string | undefined)[];
}

function TierCells({
  row,
  group,
  onSelect,
}: {
  row: TableRow;
  group: DocumentGroup;
  onSelect: () => void;
}) {
  const render = (values: CellValue[], key: string, colSpan = 1, first = false) => (
    <td key={key} colSpan={colSpan} className={first ? "table__group-start" : undefined}>
      {values.length > 0 ? (
        values.map((v, i) => (
          <button
            key={i}
            className="cell-value"
            onClick={onSelect}
            title="Show source evidence"
          >
            {v.display}
          </button>
        ))
      ) : (
        <span className="table__empty" aria-label="Not found">
          —
        </span>
      )}
    </td>
  );

  const own = cellValues(row.values, group.documentId);
  // A multi-tier document with only tier-agnostic values (or none at all)
  // shows one cell spanning its tier columns rather than repeating it.
  if (group.tiers.length > 1 && own.every((v) => !v.qualifiers.planTier?.trim())) {
    return render(own, group.documentId, group.visible.length, true);
  }
  return (
    <Fragment>
      {group.visible.map((tier, i) =>
        render(cellValues(row.values, group.documentId, tier), `${group.documentId}:${tier ?? ""}`, 1, i === 0),
      )}
    </Fragment>
  );
}

export default function ComparisonTable({
  table,
  onSelectCell,
}: {
  table: Table;
  onSelectCell: (cell: SelectedCell) => void;
}) {
  const groups = groupRows(table.rows);
  const tiersByDoc = useMemo(() => documentTiers(table), [table]);
  const [selection, setSelection] = useState<Record<string, string>>({});

  const docGroups: DocumentGroup[] = table.documents.map((d) => {
    const tiers = tiersByDoc.get(d.documentId) ?? [];
    if (tiers.length < 2) {
      return { documentId: d.documentId, filename: d.filename, tiers, visible: [undefined] };
    }
    const chosen = selection[d.documentId] ?? ALL_TIERS;
    const visible = chosen === ALL_TIERS ? tiers : tiers.filter((t) => t === chosen);
    return { documentId: d.documentId, filename: d.filename, tiers, visible };
  });
  const hasTierRow = docGroups.some((g) => g.tiers.length > 1);
  const valueColumns = docGroups.reduce((n, g) => n + g.visible.length, 0);
  const columns = valueColumns + 2;

  // The tier sub-header sticks just below the document header, whose height
  // depends on wrapping filenames — measure it rather than guess.
  const firstHeaderRow = useRef<HTMLTableRowElement>(null);
  const tableEl = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const row = firstHeaderRow.current;
    const el = tableEl.current;
    if (!row || !el) return;
    const apply = () => el.style.setProperty("--header-row-1", `${row.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(row);
    return () => observer.disconnect();
  }, [hasTierRow, valueColumns]);

  const select = (row: TableRow) => () =>
    onSelectCell({ factName: row.factName, verdict: row.verdict, values: row.values });

  return (
    <section className="card comparison" aria-label="Plan comparison">
      <div className="comparison__intro">
        <h2>Your plans, side by side</h2>
        <p>Select any value to see the exact wording it came from.</p>
      </div>
      <table className="table" ref={tableEl}>
        <colgroup>
          <col className="col-fact" />
          <col className="col-verdict" />
          {docGroups.map((g) =>
            g.visible.map((tier) => <col key={`${g.documentId}:${tier ?? ""}`} />),
          )}
        </colgroup>
        <thead>
          <tr ref={firstHeaderRow}>
            <th scope="col" rowSpan={hasTierRow ? 2 : 1}>
              Fact
            </th>
            <th scope="col" rowSpan={hasTierRow ? 2 : 1}>
              Verdict
            </th>
            {docGroups.map((g) =>
              g.tiers.length > 1 ? (
                <th
                  key={g.documentId}
                  scope="colgroup"
                  colSpan={g.visible.length}
                  className="table__group table__group-start"
                >
                  <span className="table__group-name">{g.filename}</span>
                  <label className="table__tier-picker">
                    <span className="sr-only">Tier shown for {g.filename}</span>
                    <select
                      className="select select--compact"
                      value={selection[g.documentId] ?? ALL_TIERS}
                      onChange={(e) =>
                        setSelection({ ...selection, [g.documentId]: e.target.value })
                      }
                    >
                      <option value={ALL_TIERS}>All tiers</option>
                      {g.tiers.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                </th>
              ) : (
                <th
                  key={g.documentId}
                  scope="col"
                  rowSpan={hasTierRow ? 2 : 1}
                  className="table__group-start"
                >
                  {g.filename}
                </th>
              ),
            )}
          </tr>
          {hasTierRow && (
            <tr className="table__tiers">
              {docGroups.flatMap((g) =>
                g.tiers.length > 1
                  ? g.visible.map((tier, i) => (
                      <th
                        key={`${g.documentId}:${tier}`}
                        scope="col"
                        className={i === 0 ? "table__group-start" : undefined}
                      >
                        {tier}
                      </th>
                    ))
                  : [],
              )}
            </tr>
          )}
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
                {docGroups.map((g) => (
                  <TierCells key={g.documentId} row={row} group={g} onSelect={select(row)} />
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}
