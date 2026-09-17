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
import { documentUrl } from "@/app/lib/document-url";
import VerdictBadge from "@/app/components/VerdictBadge";

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
  sessionId,
  filenames,
}: {
  row: TableRow;
  group: DocumentGroup;
  sessionId: string;
  filenames: Map<string, string>;
}) {
  const label = LABELS.get(row.factName) ?? row.factName;
  const render = (values: CellValue[], key: string, colSpan = 1, first = false) => (
    <td key={key} colSpan={colSpan} className={first ? "table__group-start" : undefined}>
      {values.length > 0 ? (
        values.map((v, i) => {
          // Each value links to ITS OWN primary evidence (the first cited
          // passage — deterministic); never the whole row's evidence. A
          // value with no evidence renders as plain text: the contract
          // forbids inventing a citation.
          const primary = v.evidence[0];
          if (!primary) {
            return (
              <span key={i} className="cell-value">
                {v.display}
              </span>
            );
          }
          const filename = filenames.get(v.documentId) ?? v.documentId;
          return (
            <a
              key={i}
              className="cell-value"
              href={documentUrl(sessionId, v.documentId, filename, primary.page, primary.evidenceId)}
              target="_blank"
              rel="noopener"
              title={`View source evidence for ${label} — ${filename}, page ${primary.page}`}
              aria-label={`View source evidence for ${label} — ${filename}, page ${primary.page}`}
            >
              {v.display}
            </a>
          );
        })
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
        render(
          cellValues(row.values, group.documentId, tier),
          `${group.documentId}:${tier ?? ""}`,
          1,
          i === 0,
        ),
      )}
    </Fragment>
  );
}

export default function ComparisonTable({
  table,
  sessionId,
}: {
  table: Table;
  sessionId: string;
}) {
  const groups = groupRows(table.rows);
  const [activeSection, setActiveSection] = useState(groups[0]?.section.title ?? "");
  const activeGroup = groups.find(({ section }) => section.title === activeSection) ?? groups[0];
  const tiersByDoc = useMemo(() => documentTiers(table), [table]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const filenames = useMemo(
    () => new Map(table.documents.map((d) => [d.documentId, d.filename] as const)),
    [table],
  );

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

  return (
    <section
      className="card comparison"
      style={{ "--value-columns": valueColumns } as React.CSSProperties}
      aria-label="Plan comparison"
    >
      <div className="comparison__intro">
        <h2>Your plans, side by side</h2>
        <p>Open any value to see the exact source page it came from.</p>
      </div>

      <div className="comparison__tabs" role="group" aria-label="Comparison sections">
        {groups.map(({ section }) => {
          const active = section.title === activeGroup?.section.title;
          return (
            <button
              key={section.title}
              type="button"
              className="comparison__tab"
              aria-pressed={active}
              onClick={() => setActiveSection(section.title)}
            >
              {section.title}
            </button>
          );
        })}
      </div>

      {activeGroup && (
        <div className="comparison__section-summary" aria-live="polite">
          <h3>{activeGroup.section.title}</h3>
          <p>{activeGroup.section.description}</p>
        </div>
      )}

      <div className="comparison__table-wrap">
        <table className="table" ref={tableEl} aria-label={activeGroup?.section.title ?? "Comparison"}>
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
                What matters
              </th>
              <th scope="col" rowSpan={hasTierRow ? 2 : 1}>
                Status
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
          <tbody>
            {(activeGroup?.rows ?? []).map((row) => (
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
                  <TierCells key={g.documentId} row={row} group={g} sessionId={sessionId} filenames={filenames} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
