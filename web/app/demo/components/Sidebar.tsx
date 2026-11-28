"use client";

import { useEffect, useState, type RefObject } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import s from "../demo.module.css";
import { MAX_DOCS, NEED_DEFS, type NeedState } from "../lib/demo-logic";
import { PdfButton, cx, useDemo } from "./shared";

/** Commits on change (blur or Enter), like the demo's `change` event; invalid input reverts. */
function Threshold({ value, label, onCommit }: { value: number; label: string; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const x = parseFloat(draft);
    if (isNaN(x) || x < 0) setDraft(String(value));
    else if (x !== value) onCommit(x);
  };
  return (
    <span className={s.money}>
      $
      <input
        type="number"
        min={0}
        step={100}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key == "Enter") commit();
        }}
      />
    </span>
  );
}

export interface SidebarProps {
  loaded: string[];
  sel: ReadonlySet<string>;
  selected: string[];
  adding: boolean;
  needs: NeedState[];
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onToggleDoc: (docId: string) => void;
  onTogglePlan: (planId: string) => void;
  onAdd: () => void;
  /** When adding is not possible here: why, shown under a disabled button. */
  addNote?: string;
  onNeed: (i: number, patch: Partial<NeedState>) => void;
}

export function Sidebar(p: SidebarProps) {
  const { M } = useDemo();
  return (
    <div className={s.sbIn}>
      <div className={s.sbTop}>
        <h2 className={s.sbh} style={{ marginTop: "var(--s1)" }}>
          Your documents
        </h2>
        <button type="button" className={s.quiet} onClick={p.onClose} ref={p.closeRef} aria-label="Close sidebar">
          Done <X size={14} aria-hidden />
        </button>
      </div>
      {M.DOCS.filter((d) => p.loaded.includes(d.id)).map((d) => {
        const on = d.plans.filter((x) => p.sel.has(x)).length;
        const all = on == d.plans.length;
        return (
          <div className={s.fam} key={d.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={all ? true : on ? "mixed" : false}
              className={cx(s.ck, on > 0 && s.on)}
              onClick={() => p.onToggleDoc(d.id)}
            >
              <span className={s.box} aria-hidden>
                {all ? <Check size={12} strokeWidth={3.5} /> : on ? <Minus size={12} strokeWidth={3.5} /> : null}
              </span>
              <b>{d.family}</b>
            </button>
            <div className={s.fileName}>
              {d.file}
              <br />
              <PdfButton docId={d.id} page={1} label="Open the PDF" />
            </div>
            {d.plans.length > 1 && (
              <div role="group" aria-label={`${d.family} levels`}>
                {d.plans.map((pl) => (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={p.sel.has(pl)}
                    key={pl}
                    className={cx(s.ck, p.sel.has(pl) && s.on)}
                    onClick={() => p.onTogglePlan(pl)}
                  >
                    <span className={s.box} aria-hidden>
                      {p.sel.has(pl) ? <Check size={12} strokeWidth={3.5} /> : null}
                    </span>
                    {M.lv(pl)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {p.adding ? (
        <div className={s.fam} aria-live="polite">
          <div className={s.skeleton} aria-hidden>
            <span className={s.skel} style={{ width: "60%", height: 16 }} />
            <span className={s.skel} style={{ width: "85%" }} />
          </div>
          <div className={cx(s.muted, s.small)}>Reading travel-guard-2026.pdf… your results stay on screen.</div>
        </div>
      ) : (
        p.loaded.length < MAX_DOCS && (
          <button
            type="button"
            className={s.quiet}
            onClick={p.onAdd}
            disabled={p.addNote !== undefined || p.loaded.includes("travel")}
            aria-describedby={p.addNote ? "demo-add-note" : undefined}
          >
            <Plus size={14} aria-hidden />
            <span className={s.num}>
              Add document ({p.loaded.length} of {MAX_DOCS})
            </span>
          </button>
        )
      )}
      {p.addNote && (
        <div id="demo-add-note" className={cx(s.small, s.muted)} style={{ marginTop: "var(--s2)" }}>
          {p.addNote}
        </div>
      )}
      <div className={cx(s.small, s.muted)} style={{ marginTop: "var(--s2)" }}>
        Showing: {p.selected.map(M.nm).join(", ") || "nothing"}
      </div>

      <h2 className={s.sbh}>Your needs</h2>
      {NEED_DEFS.map((n, i) => {
        const st = p.needs[i];
        return (
          <div className={s.need} key={n.k}>
            <label>
              <input type="checkbox" checked={st.on} onChange={(e) => p.onNeed(i, { on: e.target.checked })} /> {n.l}
            </label>
            {st.th != null && <Threshold value={st.th} label={n.l} onCommit={(th) => p.onNeed(i, { th })} />}
            <button
              type="button"
              className={cx(s.mh, st.must && s.on)}
              aria-pressed={st.must}
              onClick={() => p.onNeed(i, { must: !st.must })}
            >
              {st.must ? "Must have" : "Nice to have"}
            </button>
          </div>
        );
      })}
      <div className={s.muted} style={{ fontSize: 12, marginTop: "var(--s2)" }}>
        Scores use verified facts only. Unconfirmed counts as not met. A different basis (per illness vs per year) is
        shown, not scored.
      </div>
    </div>
  );
}
