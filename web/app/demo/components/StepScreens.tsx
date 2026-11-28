"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Lock, Upload } from "lucide-react";
import s from "../demo.module.css";
import { READING_STAGES } from "../lib/demo-logic";
import { PdfButton, cx, useDemo } from "./shared";

/* ---------- Step 1: upload ---------- */
export function UploadScreen({ go }: { go: (p: "reading" | "find") => void }) {
  const { M } = useDemo();
  const [explained, setExplained] = useState(false);
  return (
    <div className={s.steppage}>
      <span className={s.eyebrow}>Step 1 of 3</span>
      <h1>Compare or understand your plans</h1>
      <p className={s.muted}>
        Upload 1 to 5 plan PDFs. One plan is explained; two or more are compared. Saved insurer web pages (Print → Save as
        PDF) work too.
      </p>
      <div className={s.card} style={{ marginTop: "var(--s5)" }}>
        <button type="button" className={s.drop} onClick={() => setExplained(true)} aria-live="polite">
          {explained ? (
            <>
              This demo uses the three sample documents below.
              <span className={s.small}>In the real app you would pick your own PDFs here.</span>
            </>
          ) : (
            <>
              <Upload size={22} aria-hidden />
              <span>
                Drop PDFs here, or <u>browse</u>
              </span>
              <span className={s.small}>Up to 5 files, 20 MB and 80 pages each</span>
            </>
          )}
        </button>
        {M.DOCS.filter((d) => d.initial).map((d) => (
          <div className={s.file} key={d.id}>
            <div className={s.fileIc} aria-hidden>
              PDF
            </div>
            <div className={s.grow}>
              <b>{d.file}</b>
              <div className={cx(s.muted, s.small)}>
                {d.type}, <span className={s.num}>{d.pages}</span> pages
              </div>
            </div>
            <PdfButton docId={d.id} page={1} label="View the demo PDF" />
            <span className={s.ok}>
              <Check size={18} strokeWidth={3} aria-hidden />
              <span className={s.srOnly}>Added</span>
            </span>
          </div>
        ))}
        <div className={s.file}>
          <div className={cx(s.fileIc, s.scan)} aria-hidden>
            IMG
          </div>
          <div className={s.grow}>
            <b>scan-policy.pdf</b>
            <div className={s.small} style={{ color: "var(--amber)", display: "flex", gap: "var(--s1)" }}>
              <CircleAlert size={16} aria-hidden className={s.icon} style={{ marginTop: 3 }} />
              <span>This file is an image scan. We can&apos;t read scans yet, so it was not added.</span>
            </div>
          </div>
        </div>
        <div className={cx(s.muted, s.small)} style={{ marginTop: "var(--s3)", display: "flex", gap: "var(--s2)" }}>
          <Lock size={16} aria-hidden className={s.icon} style={{ marginTop: 3 }} />
          <span>Deleted after 24 hours. Text inside your files is treated as data, never as instructions. Information, not advice.</span>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={() => go("reading")}>
            Read my documents
          </button>
          <button type="button" className={cx(s.btn, s.sec)} onClick={() => go("find")}>
            I don&apos;t have my documents
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Step 2: reading progress ---------- */
function SkeletonRows() {
  return (
    <div className={s.skeleton} aria-hidden>
      {[0, 1].map((i) => (
        <div className={s.skelRow} key={i}>
          <span className={s.skel} style={{ width: i ? "70%" : "100%" }} />
          <span className={s.skel} style={{ width: i ? "55%" : "85%" }} />
          <span className={s.skel} style={{ width: i ? "40%" : "65%" }} />
        </div>
      ))}
    </div>
  );
}

export function ReadingScreen({ loaded, go }: { loaded: string[]; go: (p: "results") => void }) {
  const { M } = useDemo();
  const [pr, setPr] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPr((p) => (p >= 6 ? p : p + 1)), 600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={s.steppage}>
      <span className={s.eyebrow}>Step 2 of 3</span>
      <h1>Reading your documents</h1>
      <div className={s.card}>
        {loaded.map((id, i) => {
          const d = M.docById(id);
          const p = Math.max(0, Math.min(4, pr - i));
          const st = M.readingStats(id);
          return (
            <div className={cx(s.file, s.fileBlock)} key={id} style={i == 0 ? { borderTop: 0, paddingTop: 0 } : undefined}>
              <b>{d.file}</b>
              <div className={cx(s.muted, s.small)}>
                {p >= 2
                  ? d.levels.length > 1
                    ? "1 plan family with " + d.levels.length + " levels: " + d.levels.join(", ")
                    : "1 plan: " + d.levels[0]
                  : "Waiting…"}
              </div>
              <div
                className={s.bar}
                role="progressbar"
                aria-label={`${d.file} progress`}
                aria-valuemin={0}
                aria-valuemax={READING_STAGES.length}
                aria-valuenow={p + 1}
                aria-valuetext={READING_STAGES[p]}
              >
                {READING_STAGES.map((x, j) => (
                  <span key={x} className={j <= p ? s.on : undefined} />
                ))}
              </div>
              {p < 4 && <SkeletonRows />}
              <div className={cx(s.small, s.num)} aria-live="polite">
                {p >= 4 ? (
                  <span>
                    <span className={s.ok}>
                      <Check size={16} strokeWidth={3} aria-hidden />
                    </span>{" "}
                    {st.n} benefits found
                    {st.u ? ", " + st.u + " couldn't be confirmed" : ""}
                    {st.k ? ", " + st.k + " conflicting" : ""}
                  </span>
                ) : (
                  READING_STAGES[p] + "…"
                )}
              </div>
            </div>
          );
        })}
        <div className={cx(s.muted, s.small)} style={{ marginTop: "var(--s3)" }}>
          Each stage is saved as it finishes. If something fails, it resumes from the last finished stage.
        </div>
        {pr >= 6 && (
          <button type="button" className={s.btn} style={{ marginTop: "var(--s4)" }} onClick={() => go("results")}>
            See results
          </button>
        )}
      </div>
    </div>
  );
}
