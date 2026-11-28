"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Lock, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import s from "../demo.module.css";
import { READING_STAGES, type DemoModel } from "../lib/demo-logic";
import { cx } from "./shared";

export const MAX_FILES = 5;
const MAX_BYTES = 20 * 1024 * 1024;

export interface Rejected {
  name: string;
  reason: string;
}

/** Client-side checks before anything is sent (the server checks again). */
export function checkFiles(current: File[], added: File[]): { files: File[]; rejected: Rejected[] } {
  const files = [...current];
  const rejected: Rejected[] = [];
  for (const f of added) {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf")
      rejected.push({ name: f.name, reason: "This isn't a PDF, so it was not added." });
    else if (f.size > MAX_BYTES) rejected.push({ name: f.name, reason: "This file is over 20 MB, so it was not added." });
    else if (files.some((x) => x.name === f.name && x.size === f.size))
      rejected.push({ name: f.name, reason: "This file is already in the list." });
    else if (files.length >= MAX_FILES)
      rejected.push({ name: f.name, reason: `Up to ${MAX_FILES} files per comparison, so it was not added.` });
    else files.push(f);
  }
  return { files, rejected };
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/* ---------- Step 1: upload (real files) ---------- */
export function LiveUpload(p: {
  files: File[];
  rejected: Rejected[];
  consent: boolean;
  onAdd: (added: File[]) => void;
  onRemove: (i: number) => void;
  onConsent: (v: boolean) => void;
  onRead: () => void;
  go: (screen: "find") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={s.steppage}>
      <span className={s.eyebrow}>Step 1 of 3</span>
      <h1>Compare or understand your plans</h1>
      <p className={s.muted}>
        Upload 1 to 5 plan PDFs. One plan is explained; two or more are compared. Saved insurer web pages (Print → Save as
        PDF) work too.
      </p>
      <div className={s.card} style={{ marginTop: "var(--s5)" }}>
        <button
          type="button"
          className={s.drop}
          style={over ? { borderColor: "var(--cobalt)" } : undefined}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            p.onAdd([...e.dataTransfer.files]);
          }}
        >
          <Upload size={22} aria-hidden />
          <span>
            Drop PDFs here, or <u>browse</u>
          </span>
          <span className={s.small}>Up to 5 files, 20 MB and 80 pages each</span>
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          aria-label="Choose plan PDFs"
          onChange={(e) => {
            p.onAdd([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        {p.files.map((f, i) => (
          <div className={s.file} key={f.name + f.size}>
            <div className={s.fileIc} aria-hidden>
              PDF
            </div>
            <div className={s.grow}>
              <b style={{ overflowWrap: "anywhere" }}>{f.name}</b>
              <div className={cx(s.muted, s.small, s.num)}>{size(f.size)}</div>
            </div>
            <span className={s.ok}>
              <Check size={18} strokeWidth={3} aria-hidden />
              <span className={s.srOnly}>Ready</span>
            </span>
            <button type="button" className={cx(s.quiet, s.iconBtn)} onClick={() => p.onRemove(i)} aria-label={`Remove ${f.name}`}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
        {p.rejected.map((r) => (
          <div className={s.file} key={"x" + r.name} role="alert">
            <div className={cx(s.fileIc, s.scan)} aria-hidden>
              !
            </div>
            <div className={s.grow}>
              <b style={{ overflowWrap: "anywhere" }}>{r.name}</b>
              <div className={s.small} style={{ color: "var(--amber)" }}>
                {r.reason}
              </div>
            </div>
          </div>
        ))}
        <label className={s.consent}>
          <input type="checkbox" checked={p.consent} onChange={(e) => p.onConsent(e.target.checked)} />
          <span>
            <b>
              <Sparkles size={14} aria-hidden className={s.icon} /> Let Claude read the pages our own readers can&apos;t settle,
              and let AI double-check the values
            </b>
            <br />
            <span className={cx(s.muted, s.small)}>
              Those pages are sent to Anthropic&apos;s Claude through our AI gateway (KodeKloud). Every value found is
              checked word for word against your PDF, then confirmed by a second AI from another company: Claude checks
              what our readers found, and OpenAI&apos;s GPT checks what Claude found, so we only send it the printed lines
              and nearby text. Claude also writes one plain-English line from the printed words. Anything that
              can&apos;t be confirmed is shown as &ldquo;check page N&rdquo;. Without this, only our own readers run and
              nothing is marked verified.
            </span>
          </span>
        </label>
        <div className={cx(s.muted, s.small)} style={{ marginTop: "var(--s3)", display: "flex", gap: "var(--s2)" }}>
          <Lock size={16} aria-hidden className={s.icon} style={{ marginTop: 3 }} />
          <span>Deleted after 24 hours. Text inside your files is treated as data, never as instructions. Information, not advice.</span>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.btn} onClick={p.onRead} disabled={!p.files.length}>
            Read my documents
          </button>
          <button type="button" className={cx(s.btn, s.sec)} onClick={() => p.go("find")}>
            I don&apos;t have my documents
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Step 2: reading (real request) ---------- */
export type ReadPhase = "uploading" | "reading" | "done" | "error";

export function LiveReading(p: {
  names: string[];
  phase: ReadPhase;
  error: string;
  M: DemoModel | null;
  onResults: () => void;
  onRetry: () => void;
  onStartOver: () => void;
}) {
  // The engine reads all documents in one request: stages advance while it works, and
  // stop at "Verifying" until it answers. Nothing here claims progress it doesn't know.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (p.phase !== "reading") return;
    const t = setInterval(() => setTick((x) => x + 1), 2500);
    return () => clearInterval(t);
  }, [p.phase]);
  const stage = p.phase === "uploading" ? 0 : p.phase === "done" ? 4 : Math.min(3, 1 + tick);

  if (p.phase === "error")
    return (
      <div className={s.steppage}>
        <span className={s.eyebrow}>Step 2 of 3</span>
        <h1>Reading your documents</h1>
        <div className={cx(s.card, s.empty)} role="alert">
          <div className={s.errorIc} style={{ marginBottom: 0 }}>
            <CircleAlert size={24} aria-hidden />
          </div>
          <h2>We couldn&apos;t read your documents</h2>
          <p className={s.muted}>{p.error}</p>
          <div className={s.actions} style={{ marginTop: 0 }}>
            <button type="button" className={s.btn} onClick={p.onRetry}>
              <RotateCcw size={16} aria-hidden />
              Try again
            </button>
            <button type="button" className={cx(s.btn, s.sec)} onClick={p.onStartOver}>
              Choose other files
            </button>
          </div>
        </div>
      </div>
    );

  const docs = p.M?.DOCS ?? [];
  return (
    <div className={s.steppage}>
      <span className={s.eyebrow}>Step 2 of 3</span>
      <h1>Reading your documents</h1>
      <div className={s.card}>
        {p.names.map((name, i) => {
          const d = docs[i];
          const plan = d?.plans[0];
          const keys = plan && p.M ? p.M.KEYS.filter((k) => p.M!.F(plan, k)) : [];
          const u = keys.filter((k) => p.M!.F(plan!, k)?.s === "u").length;
          const k = keys.filter((k) => p.M!.F(plan!, k)?.s === "k").length;
          return (
            <div className={cx(s.file, s.fileBlock)} key={name + i} style={i == 0 ? { borderTop: 0, paddingTop: 0 } : undefined}>
              <b style={{ overflowWrap: "anywhere" }}>{name}</b>
              <div className={cx(s.muted, s.small)}>{stage >= 2 && d ? "1 plan: " + d.family : "Waiting…"}</div>
              <div
                className={s.bar}
                role="progressbar"
                aria-label={`${name} progress`}
                aria-valuemin={0}
                aria-valuemax={READING_STAGES.length}
                aria-valuenow={stage + 1}
                aria-valuetext={READING_STAGES[stage]}
              >
                {READING_STAGES.map((x, j) => (
                  <span key={x} className={j <= stage ? s.on : undefined} />
                ))}
              </div>
              {stage < 4 && (
                <div className={s.skeleton} aria-hidden>
                  {[0, 1].map((r) => (
                    <div className={s.skelRow} key={r}>
                      <span className={s.skel} style={{ width: r ? "70%" : "100%" }} />
                      <span className={s.skel} style={{ width: r ? "55%" : "85%" }} />
                      <span className={s.skel} style={{ width: r ? "40%" : "65%" }} />
                    </div>
                  ))}
                </div>
              )}
              <div className={cx(s.small, s.num)} aria-live="polite">
                {stage >= 4 ? (
                  <span>
                    <span className={s.ok}>
                      <Check size={16} strokeWidth={3} aria-hidden />
                    </span>{" "}
                    {keys.length} benefits found
                    {u ? ", " + u + " couldn't be confirmed" : ""}
                    {k ? ", " + k + " conflicting" : ""}
                  </span>
                ) : (
                  READING_STAGES[stage] + "…"
                )}
              </div>
            </div>
          );
        })}
        <div className={cx(s.muted, s.small)} style={{ marginTop: "var(--s3)" }}>
          Reading takes up to a few minutes per document. Keep this page open.
        </div>
        {p.phase === "done" && (
          <button type="button" className={s.btn} style={{ marginTop: "var(--s4)" }} onClick={p.onResults}>
            See results
          </button>
        )}
      </div>
    </div>
  );
}
