"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { matchEvidencePassage, type HighlightRect } from "@/app/lib/pdf/text-match";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; match: "unique" | "none" | "ambiguous" }
  | { kind: "failed"; reason: "password" | "unavailable" };

/** App-controlled evidence renderer: draws the cited page of the ORIGINAL
 *  uploaded PDF onto a canvas and overlays highlight rectangles computed
 *  from the PDF's own text layer. No pdf-lib rewriting, no browser
 *  `#page=` fragment, no CDN worker — the worker ships with the package.
 *
 *  Highlight honesty is structural: rectangles render only for a UNIQUE
 *  confident match. Zero or several matches render the page with an
 *  explicit message instead — never an arbitrary highlight.
 *
 *  VIEWER FROZEN after C0 proof (todo 6): annotations, bookmarks,
 *  in-viewer search, and editing are explicitly out of scope. Changes here
 *  are bug-fixes to the frozen contract only (correct page + unique-match
 *  highlight or honest fallback). */
export default function PdfEvidenceViewer({
  pdfUrl,
  page,
  quote,
}: {
  pdfUrl: string;
  page: number;
  /** Exact cited quote, or null when no validated evidence backs the view. */
  quote: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [rects, setRects] = useState<{ x: number; y: number; width: number; height: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Package-controlled worker (pdfjs-dist/webpack entry cannot be typed
    // cleanly here, so the worker file ships via import.meta.url instead —
    // same bundle, no CDN).
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();

    async function run() {
      const loadingTask = pdfjsLib.getDocument({ url: pdfUrl, password: "" });
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          void loadingTask.destroy().catch(() => undefined);
        }
      };
      try {
        // Empty-string password opens files with no user password (the
        // common "restricted" case, e.g. owner-password-only PDFs) while
        // leaving ordinary files untouched. A real password prompt still
        // fails explicitly into the fallback below.
        const pdf = await loadingTask.promise;
        if (cancelled) {
          finish();
          return;
        }
        if (page < 1 || page > pdf.numPages) {
          finish();
          setStatus({ kind: "failed", reason: "unavailable" });
          return;
        }
        const pdfPage = await pdf.getPage(page);
        if (cancelled) {
          finish();
          return;
        }
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) {
          finish();
          return;
        }
        const cssWidth = Math.max(320, container.clientWidth);
        const cssScale = cssWidth / pdfPage.getViewport({ scale: 1 }).width;
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = pdfPage.getViewport({ scale: cssScale * outputScale });
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${Math.floor(cssWidth)}px`;
        canvas.style.height = `${Math.floor(renderViewport.height / outputScale)}px`;
        await pdfPage.render({ canvas, viewport: renderViewport }).promise;
        if (cancelled) {
          finish();
          return;
        }

        if (quote) {
          const content = await pdfPage.getTextContent();
          if (cancelled) {
            finish();
            return;
          }
          const items = content.items
            .filter((item): item is typeof item & { str: string } =>
              typeof (item as { str?: unknown }).str === "string"
            )
            .map((item) => {
              const text = item as unknown as {
                str: string;
                hasEOL: boolean;
                transform: number[];
                width: number;
                height: number;
              };
              return {
                str: text.str,
                hasEOL: text.hasEOL,
                transform: text.transform,
                width: text.width,
                height: text.height,
              };
            });
          const found = matchEvidencePassage(items, quote);
          if (found.status === "unique") {
            const cssViewport = pdfPage.getViewport({ scale: cssScale });
            setRects(found.rects.map((rect) => viewportRectangle(cssViewport, rect)));
            setStatus({ kind: "ready", match: "unique" });
          } else {
            setStatus({ kind: "ready", match: found.status });
          }
        } else {
          setStatus({ kind: "ready", match: "none" });
        }
        finish();
      } catch (err) {
        finish();
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setStatus({
          kind: "failed",
          reason: name === "PasswordException" ? "password" : "unavailable",
        });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, page, quote]);

  if (status.kind === "failed") {
    return (
      <div className="stack">
        <p className="text-muted" role="note">
          {status.reason === "password"
            ? "This document requires a password, so the cited page cannot be rendered here."
            : "This document cannot be rendered here, so the original file is shown instead."}{" "}
          The exact cited passage is quoted below.
        </p>
        <iframe
          title="Original document"
          src={`${pdfUrl}#page=${page}`}
          style={{ width: "100%", height: "70vh", border: "1px solid #ccc" }}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
        <canvas ref={canvasRef} aria-label={`Source page ${page}`} />
        {rects.map((r, i) => (
          <div
            key={i}
            data-testid="evidence-highlight"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: r.x,
              top: r.y,
              width: r.width,
              height: r.height,
              backgroundColor: "rgba(255, 213, 74, 0.45)",
              pointerEvents: "none",
            }}
          />
        ))}
      </div>
      {status.kind === "ready" && status.match === "none" && quote ? (
        <p className="text-muted">
          Source page opened, but the exact passage could not be highlighted automatically.
        </p>
      ) : null}
      {status.kind === "ready" && status.match === "ambiguous" ? (
        <p className="text-muted">
          The source page contains multiple matching passages, so automatic
          highlighting was withheld.
        </p>
      ) : null}
    </div>
  );
}

function viewportRectangle(
  viewport: { convertToViewportPoint: (x: number, y: number) => number[] },
  rect: HighlightRect
): { x: number; y: number; width: number; height: number } {
  const [x0, y0, x1, y1] = rect.box;
  const [ax, ay] = viewport.convertToViewportPoint(x0, y0);
  const [bx, by] = viewport.convertToViewportPoint(x1, y1);
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}
