"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import s from "../demo.module.css";
import { cx, useDemo } from "./shared";

export type ViewerTarget =
  | { kind: "src"; planId: string; key: string }
  | { kind: "pdf"; docId: string; page: number };

export const demoPdfUrl = (docId: string, page: number) => `/demo/pdf/${encodeURIComponent(docId)}#page=${page}`;
export const DEMO_PDF_NOTE = "A demo PDF made for this demo, not a real insurance document.";

export function PdfViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const { M, pdfUrl, pdfNote } = useDemo();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);

  let docId: string;
  let page: number;
  let title: string;
  let meta: string;
  let look: string | null = null;
  if (target.kind == "src") {
    const c = M.F(target.planId, target.key)!;
    const d = M.docOf(target.planId);
    docId = d.id;
    page = c.p;
    title = `${M.nm(target.planId)}: ${M.CAT[target.key][1]}`;
    meta = `${d.file}, ${M.pageLabel(target.planId, c.p)}.`;
    look = c.look || c.w || null;
  } else {
    const d = M.docById(target.docId);
    docId = d.id;
    page = target.page;
    title = d.family;
    meta = `${d.file}, page ${page} of ${d.pages}.`;
  }
  const url = pdfUrl(docId, page);

  return (
    <div
      className={s.viewer}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={s.vpanel}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-viewer-title"
        onKeyDown={(e) => {
          if (e.key != "Tab") return;
          const f = panelRef.current?.querySelectorAll<HTMLElement>("a[href],button,iframe");
          if (!f?.length) return;
          const first = f[0];
          const last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className={s.vhead}>
          <div className={s.vheadRow}>
            <div>
              <h2 id="demo-viewer-title" style={{ fontSize: 19 }}>
                {title}
              </h2>
              <div className={cx(s.small, s.muted, s.num)}>
                {meta} {pdfNote}
              </div>
            </div>
            <div className={s.vactions}>
              <a className={s.quiet} href={url} target="_blank" rel="noopener">
                <ExternalLink size={14} aria-hidden />
                Open in new tab
              </a>
              <button type="button" className={s.quiet} onClick={onClose} ref={closeRef}>
                Close <X size={14} aria-hidden />
              </button>
            </div>
          </div>
          {look && (
            <div className={s.look}>
              Look for <mark>{look}</mark>
            </div>
          )}
        </div>
        <iframe key={url} className={s.vframe} src={url} title={`Demo PDF: ${title}, page ${page}`} />
      </div>
    </div>
  );
}
