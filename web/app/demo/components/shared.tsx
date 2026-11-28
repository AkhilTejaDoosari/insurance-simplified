"use client";

import { createContext, useContext } from "react";
import { CircleAlert, CircleCheck, CircleDashed, CircleX, FileText, TriangleAlert, type LucideIcon } from "lucide-react";
import s from "../demo.module.css";
import type { DemoState } from "../lib/demo-adapter";
import { LB, type DemoModel } from "../lib/demo-logic";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export interface DemoActions {
  M: DemoModel;
  /** Open the PDF viewer at a fact's page. */
  openSource: (planId: string, key: string, opener: HTMLElement | null) => void;
  /** Open the PDF viewer at a document page. */
  openPdf: (docId: string, page: number, opener: HTMLElement | null) => void;
  /** URL of a document's PDF at a page (demo PDF, or the session's own document). */
  pdfUrl: (docId: string, page: number) => string;
  /** Said under the viewer title: what this PDF is. */
  pdfNote: string;
}

export const DemoContext = createContext<DemoActions | null>(null);
export function useDemo(): DemoActions {
  const v = useContext(DemoContext);
  if (!v) throw new Error("useDemo outside DemoContext");
  return v;
}

const STATE_ICON: Record<DemoState | "n", LucideIcon> = {
  v: CircleCheck,
  x: CircleX,
  u: CircleAlert,
  k: TriangleAlert,
  n: CircleDashed,
};

/** State badge: always icon + words, never colour alone. */
export function StateBadge({ state }: { state: DemoState | "n" }) {
  const Icon = STATE_ICON[state];
  return (
    <span className={cx(s.b, s[state])}>
      <Icon size={14} strokeWidth={2.5} aria-hidden className={s.icon} />
      {state == "n" ? "Not mentioned" : LB[state]}
    </span>
  );
}

export function SourceButton({ id, k, label }: { id: string; k: string; label: string }) {
  const { openSource } = useDemo();
  return (
    <button type="button" className={s.srcl} onClick={(e) => openSource(id, k, e.currentTarget)}>
      <FileText size={14} aria-hidden className={s.icon} />
      {label}
    </button>
  );
}

export function PdfButton({ docId, page, label }: { docId: string; page: number; label: string }) {
  const { openPdf } = useDemo();
  return (
    <button type="button" className={s.srcl} onClick={(e) => openPdf(docId, page, e.currentTarget)}>
      <FileText size={14} aria-hidden className={s.icon} />
      {label}
    </button>
  );
}

/** One plan's value for one benefit (the demo's `cell`). */
export function Cell({ id, k }: { id: string; k: string }) {
  const { M } = useDemo();
  const c = M.F(id, k);
  if (!c)
    return (
      <>
        <StateBadge state="n" />
        <div className={s.ex}>
          This document doesn&apos;t mention it. We searched the whole document; that&apos;s not the same as excluded.
        </div>
      </>
    );
  return (
    <>
      <StateBadge state={c.s} />
      <div className={s.val}>{c.d}</div>
      {c.pl && <div className={s.pl}>{c.pl}</div>}
      {c.w && (
        <div className={s.q}>
          In the document: <mark>{c.w}</mark>
        </div>
      )}
      <SourceButton id={id} k={k} label={M.pageLabel(id, c.p)} />
    </>
  );
}

/** Benefit name, its general explanation, and Differs / Different basis marks. */
export function BenefitLabel({ k, ids }: { k: string; ids?: string[] }) {
  const { M } = useDemo();
  const marks = ids ? M.rowMarks(k, ids) : null;
  return (
    <>
      <div className={s.rowname}>{M.CAT[k][1]}</div>
      {M.CAT[k][2] && <div className={s.ex}>General info: {M.CAT[k][2]}</div>}
      {marks?.differentBasis && <span className={cx(s.mk, s.bas)}>Different basis</span>}
      {marks?.differs && <span className={cx(s.mk, s.d)}>Differs</span>}
    </>
  );
}
