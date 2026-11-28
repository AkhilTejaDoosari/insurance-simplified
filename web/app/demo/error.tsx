"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import s from "./demo.module.css";
import { bodyFont, displayFont } from "./fonts";

/** Designed error state for /demo: shown if the demo data fails its shape check or a screen throws. */
export default function DemoError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className={[s.root, displayFont.variable, bodyFont.variable].join(" ")}>
      <div className={s.errorPage} role="alert">
        <div className={s.errorIc}>
          <TriangleAlert size={24} aria-hidden />
        </div>
        <h1 style={{ fontSize: 32, marginBottom: "var(--s3)" }}>The demo couldn&apos;t load</h1>
        <p className={s.muted} style={{ marginBottom: "var(--s6)" }}>
          Something went wrong while showing the demo plans. Nothing was uploaded and no data was lost.
        </p>
        <button type="button" className={s.btn} onClick={reset}>
          <RotateCcw size={16} aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}
