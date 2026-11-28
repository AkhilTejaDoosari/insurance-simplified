"use client";

// V2 results screen (docs/v2/design.md "Results", D-038), fed by the engine's
// facts. Every value shown is the document's own printed words with its page;
// the badge is the engine's state. Nothing is interpreted or scored here: the
// match score needs the user's needs and scoring (WP9), so the gauge shows the
// share of values confirmed by both checks, labelled as exactly that.

import React, { useMemo, useState } from "react";
import type { V2Document, V2Fact } from "@/app/lib/engine/client";
import type { ContactHit } from "@/app/lib/extraction/contacts";
import { documentUrl } from "@/app/lib/document-url";

const MAX_COLUMNS = 5;

type Show = "everything" | "verified" | "check";

const STATE: Record<V2Fact["state"], { label: string; tone: string }> = {
  verified: { label: "Verified", tone: "leaf" },
  couldnt_confirm: { label: "Couldn't confirm", tone: "amber" },
  conflicting: { label: "Conflicting", tone: "amber" },
  not_covered: { label: "Not covered", tone: "signal" },
  not_mentioned: { label: "Not mentioned", tone: "slate" },
};

interface Row {
  key: string;
  label: string;
  column: string;
  cells: Map<string, V2Fact[]>;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function shortName(filename: string): string {
  return filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
}

export function buildRows(docs: V2Document[]): Row[] {
  const rows = new Map<string, Row>();
  for (const d of docs) {
    for (const f of d.facts) {
      const column = f.column && f.column !== "Answers" ? f.column : "";
      const key = `${norm(f.label)}|${norm(column)}`;
      const row = rows.get(key) ?? { key, label: f.label, column, cells: new Map() };
      row.cells.set(d.documentId, [...(row.cells.get(d.documentId) ?? []), f]);
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

function shown(f: V2Fact, show: Show): boolean {
  if (show === "verified") return f.state === "verified";
  if (show === "check") return f.state !== "verified";
  return true;
}

function Gauge({ confirmed, total }: { confirmed: number; total: number }) {
  const p = total ? Math.round((confirmed / total) * 100) : 0;
  const a = Math.PI * (1 - p / 100);
  const x = (100 + 80 * Math.cos(a)).toFixed(1);
  const y = (100 - 80 * Math.sin(a)).toFixed(1);
  return (
    <svg viewBox="0 0 200 115" role="img" className="v2-gauge">
      <title>{`${p} percent of values confirmed by both checks`}</title>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--line)" strokeWidth="14" strokeLinecap="round" />
      {p > 0 && (
        <path d={`M20 100 A80 80 0 0 1 ${x} ${y}`} fill="none" stroke="var(--action)" strokeWidth="14" strokeLinecap="round" />
      )}
      <text x="100" y="92" textAnchor="middle" className="v2-gauge__num">
        {p}%
      </text>
    </svg>
  );
}

export default function ResultsV2({
  documents,
  sessionId,
  contacts,
  busy,
  onAddDocument,
  onDownload,
  onAsk,
}: {
  documents: V2Document[];
  sessionId: string;
  contacts: ContactHit[];
  busy?: boolean;
  onAddDocument: () => void;
  onDownload: () => void;
  onAsk: () => void;
}) {
  const [sidebar, setSidebar] = useState(false);
  const [compact, setCompact] = useState(false);
  const [show, setShow] = useState<Show>("everything");
  const [selected, setSelected] = useState<string[]>(() =>
    documents.slice(0, MAX_COLUMNS).map((d) => d.documentId),
  );
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);

  const docs = useMemo(
    () => selected.map((id) => documents.find((d) => d.documentId === id)).filter((d): d is V2Document => !!d),
    [documents, selected],
  );
  const rows = useMemo(() => buildRows(docs), [docs]);
  const allFacts = docs.flatMap((d) => d.facts);
  const visibleFacts = allFacts.filter((f) => shown(f, show));
  const visibleRows = rows.filter((r) => [...r.cells.values()].flat().some((f) => shown(f, show)));

  const groups =
    docs.length > 1
      ? [
          { id: "all", title: "In all plans", rows: visibleRows.filter((r) => r.cells.size === docs.length) },
          {
            id: "some",
            title: "In some plans",
            rows: visibleRows.filter((r) => r.cells.size > 1 && r.cells.size < docs.length),
          },
          { id: "one", title: "Only in one plan", rows: visibleRows.filter((r) => r.cells.size === 1) },
        ]
      : [{ id: "one-doc", title: "What this document says", rows: visibleRows }];

  function toggle(id: string) {
    setSelected((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= MAX_COLUMNS
          ? cur
          : documents.filter((d) => d.documentId === id || cur.includes(d.documentId)).map((d) => d.documentId),
    );
  }

  function openPage(d: V2Document, f: V2Fact | null, page: number) {
    setViewer({
      url: documentUrl(sessionId, d.documentId, d.filename, page, f?.evidenceId),
      title: f ? `${shortName(d.filename)}: ${f.label}, page ${page}` : `${shortName(d.filename)}, page ${page}`,
    });
  }

  const hidden = allFacts.length - visibleFacts.length;

  return (
    <div className={`v2${compact ? " v2--compact" : ""}`}>
      <div className="v2-toolbar" role="toolbar" aria-label="Results tools">
        <button
          type="button"
          className="v2-menu"
          aria-expanded={sidebar}
          aria-controls="v2-sidebar"
          onClick={() => setSidebar((o) => !o)}
        >
          <span aria-hidden="true">☰</span> Documents
        </button>
        <h1 className="v2-title">
          Your plans{" "}
          <span className="v2-count">
            {docs.length} of {documents.length} · {allFacts.length} values
          </span>
        </h1>
        <label className="v2-show">
          Show
          <select value={show} onChange={(e) => setShow(e.target.value as Show)}>
            <option value="everything">Everything</option>
            <option value="verified">Verified only</option>
            <option value="check">Needs checking</option>
          </select>
        </label>
        <button type="button" className="quiet" aria-pressed={compact} onClick={() => setCompact((c) => !c)}>
          Compact view
        </button>
        <button type="button" className="btn btn--secondary" onClick={onDownload} disabled={busy}>
          Download report
        </button>
        <button type="button" className="btn" onClick={onAsk}>
          Ask a question
        </button>
      </div>

      <div className="v2-body">
        {sidebar && (
          <aside id="v2-sidebar" className="v2-sidebar" aria-label="Your documents">
            <div className="v2-sidebar__head">
              <h2>Your documents</h2>
              <button type="button" className="quiet" onClick={() => setSidebar(false)}>
                Done ✕
              </button>
            </div>
            {documents.map((d) => (
              <div key={d.documentId} className="v2-doc">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(d.documentId)}
                    disabled={!selected.includes(d.documentId) && selected.length >= MAX_COLUMNS}
                    onChange={() => toggle(d.documentId)}
                  />
                  <b>{shortName(d.filename)}</b>
                </label>
                <div className="v2-doc__meta">
                  {d.pages} pages · {d.facts.length} values
                  <br />
                  <button type="button" className="v2-src" onClick={() => openPage(d, null, 1)}>
                    Open the PDF
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn--secondary v2-add" onClick={onAddDocument}>
              + Add document
            </button>
            <p className="v2-note">Up to {MAX_COLUMNS} plans side by side.</p>
          </aside>
        )}

        <div className="v2-main">
          <section className="v2-panel" aria-label="Per-plan summary">
            {docs.map((d) => {
              const verified = d.facts.filter((f) => f.state === "verified").length;
              const unsure = d.facts.length - verified;
              return (
                <div key={d.documentId} className="v2-plan">
                  <div className="v2-plan__name">{shortName(d.filename)}</div>
                  <Gauge confirmed={verified} total={d.facts.length} />
                  <div className="v2-plan__sub">confirmed by both checks</div>
                  <div className="v2-counts">
                    <span className="v2-b leaf">{verified} verified</span>
                    <span className="v2-b amber">{unsure} couldn&apos;t confirm</span>
                    {d.openItems.length > 0 && (
                      <span className="v2-b slate">{d.openItems.length} lines to check</span>
                    )}
                  </div>
                </div>
              );
            })}
            {docs.length === 0 && <p>Choose at least one document in ☰ Documents.</p>}
          </section>

          <div className="v2-filterbar" role="status">
            Showing {visibleFacts.length} of {allFacts.length} values
            {hidden > 0 ? `. Hidden: ${hidden}.` : "."}
            {show !== "everything" && (
              <button type="button" className="quiet" onClick={() => setShow("everything")}>
                Show everything
              </button>
            )}
          </div>

          {groups.map(
            (g) =>
              g.rows.length > 0 && (
                <section key={g.id} className="v2-group" aria-labelledby={`v2-g-${g.id}`}>
                  <h2 id={`v2-g-${g.id}`}>
                    {g.title} <span className="v2-count">{g.rows.length}</span>
                  </h2>
                  <div className="v2-tw">
                    <table className="v2-cmp">
                      <thead>
                        <tr>
                          <th scope="col" className="v2-lab">
                            Benefit
                          </th>
                          {docs.map((d) => (
                            <th scope="col" key={d.documentId}>
                              {shortName(d.filename)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.key}>
                            <th scope="row" className="v2-lab">
                              <div className="v2-rowname">{r.label}</div>
                              {r.column && <div className="v2-col">{r.column}</div>}
                            </th>
                            {docs.map((d) => {
                              const facts = (r.cells.get(d.documentId) ?? []).filter((f) => shown(f, show));
                              if (!r.cells.get(d.documentId)?.length)
                                return (
                                  <td key={d.documentId}>
                                    <span className="v2-b slate">Not found</span>
                                    {!compact && (
                                      <div className="v2-ex">
                                        We didn&apos;t find this in this document. That isn&apos;t the same as not
                                        covered.
                                      </div>
                                    )}
                                  </td>
                                );
                              return (
                                <td key={d.documentId}>
                                  {facts.map((f, i) => (
                                    <div key={i} className="v2-cell">
                                      <span className={`v2-b ${STATE[f.state].tone}`}>{STATE[f.state].label}</span>
                                      <div className="v2-val">
                                        <mark>{f.quote}</mark>
                                      </div>
                                      <button type="button" className="v2-src" onClick={() => openPage(d, f, f.page)}>
                                        Page {f.page}
                                      </button>
                                    </div>
                                  ))}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ),
          )}

          {docs.some((d) => d.openItems.length > 0) && (
            <details className="v2-open">
              <summary>Lines we couldn&apos;t settle: check these pages</summary>
              {docs.map((d) =>
                d.openItems.length ? (
                  <div key={d.documentId}>
                    <b>{shortName(d.filename)}</b>
                    <ul>
                      {d.openItems.slice(0, 40).map((o, i) => (
                        <li key={i}>
                          <button type="button" className="v2-src" onClick={() => openPage(d, null, o.page)}>
                            Page {o.page}
                          </button>{" "}
                          {o.line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </details>
          )}

          {contacts.length > 0 && (
            <section className="v2-group" aria-labelledby="v2-contacts">
              <h2 id="v2-contacts">Contact the insurer</h2>
              <div className="v2-cards">
                {docs.map((d) => {
                  const mine = contacts.filter((c) => c.documentId === d.documentId);
                  if (!mine.length) return null;
                  return (
                    <div key={d.documentId} className="v2-card">
                      <h3>{shortName(d.filename)}</h3>
                      <ul>
                        {mine.slice(0, 8).map((c, i) => (
                          <li key={i}>
                            {c.purpose ?? c.kind}: <b>{c.value}</b>{" "}
                            <button type="button" className="v2-src" onClick={() => openPage(d, null, c.page)}>
                              Page {c.page}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {viewer && (
          <aside className="v2-viewer" aria-label="Original document">
            <div className="v2-viewer__head">
              <b>{viewer.title}</b>
              <span>
                <a className="quiet" href={viewer.url} target="_blank" rel="noopener noreferrer">
                  Open in new tab
                </a>{" "}
                <button type="button" className="quiet" onClick={() => setViewer(null)}>
                  Close
                </button>
              </span>
            </div>
            <iframe title={viewer.title} src={viewer.url} />
          </aside>
        )}
      </div>
    </div>
  );
}
