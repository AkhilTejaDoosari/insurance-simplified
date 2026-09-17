"use client";

import { useEffect, useState } from "react";

/** Embeds the cited single-page source PDF, falling back explicitly when
 *  the file cannot offer a single-page view (e.g. encrypted/restricted
 *  PDFs — the page endpoint answers 422 for those).
 *
 *  The availability check runs client-side on purpose: single-page
 *  rendering (pdf-lib over multi-megabyte uploads) must stay in the API
 *  route, never inside server-component render. A HEAD probe decides which
 *  URL the frame shows; the frame renders immediately so the common case
 *  has no extra wait. */
export default function SourceFrame({
  pageUrl,
  fullUrl,
  title,
}: {
  pageUrl: string;
  fullUrl: string;
  title: string;
}) {
  const [src, setSrc] = useState(pageUrl);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(pageUrl, { method: "HEAD" }).then(
      (res) => {
        if (!cancelled && !res.ok) {
          setFallback(true);
          setSrc(fullUrl);
        }
      },
      () => {
        if (!cancelled) {
          setFallback(true);
          setSrc(fullUrl);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [pageUrl, fullUrl]);

  return (
    <>
      {fallback ? (
        <p className="text-muted" role="note">
          Single-page view is unavailable for this file, so the full original
          document is shown below — the cited passage is quoted underneath.
        </p>
      ) : null}
      <iframe
        title={title}
        src={src}
        style={{ width: "100%", height: "70vh", border: "1px solid #ccc" }}
      />
    </>
  );
}
