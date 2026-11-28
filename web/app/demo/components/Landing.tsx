"use client";

import { Check, X } from "lucide-react";
import s from "../demo.module.css";
import { SourceButton, cx } from "./shared";

export function Landing({ go }: { go: (p: "upload" | "find") => void }) {
  return (
    <div className={s.page}>
      <section className={s.hero}>
        <div>
          <h1>Your insurance fine print, in plain words.</h1>
          <p className={s.lede}>
            Upload up to five plan documents. We pull out what you&apos;ll pay, what&apos;s covered and what isn&apos;t,
            explain every term, and link each fact to the page it came from.
          </p>
          <div className={s.heroActions}>
            <button type="button" className={s.btn} onClick={() => go("upload")}>
              Compare my documents
            </button>
            <button type="button" className={cx(s.btn, s.sec)} onClick={() => go("find")}>
              I don&apos;t have my documents
            </button>
          </div>
          <p className={s.assurance}>
            If something can&apos;t be confirmed from your document, we say so and show you where to look.
          </p>
        </div>
        <div
          className={s.sheetwrap}
          role="group"
          aria-label="Example: a demo plan document with highlighted phrases and their plain-English explanations"
        >
          <div className={s.sheet}>
            <div className={s.doctitle}>Campus Care Student Health Plan</div>
            <div className={s.docmeta}>Demo document, excerpt</div>
            <p>
              Section 4. Deductible. The Insured Person must satisfy the{" "}
              <span className={s.sweep}>Deductible of $250 per Injury or Sickness</span> before benefits are payable. The
              Deductible applies separately to each covered Injury or Sickness.
            </p>
            <p>
              Section 5. Limitations.{" "}
              <span className={cx(s.sweep, s.two)}>Pre-existing conditions are excluded for the first 12 months</span> of
              continuous coverage under this Policy.
            </p>
            <p>All benefits are subject to the Schedule of Benefits and the terms of the Policy.</p>
          </div>
          <div className={s.margin}>
            <div className={cx(s.note, s.n1)}>
              <b>In plain words</b>
              You pay $250 for each new illness or injury. A second, separate illness means another $250.
              <br />
              <SourceButton id="c1" k="ded" label="See it on page 2" />
            </div>
            <div className={cx(s.note, s.n2)}>
              <b>In plain words</b>
              Health problems you already had aren&apos;t covered during your first 12 months.
              <br />
              <SourceButton id="c1" k="pre" label="See it on page 9" />
            </div>
          </div>
        </div>
      </section>
      <section className={s.flow}>
        <h2>How a fact gets to your screen</h2>
        <p className={s.sub}>An AI reads your documents. Code then checks every value against the page before you see it.</p>
        <ol className={s.steps}>
          <li>
            <b>You upload</b>
            <span>One to five plan PDFs. They&apos;re deleted after 24 hours.</span>
          </li>
          <li>
            <b>We read every page</b>
            <span>Tables, columns and plan levels, in the document&apos;s own words.</span>
          </li>
          <li>
            <b>We check it twice</b>
            <span>The value must be on the page, and a second AI must agree on what it means.</span>
          </li>
          <li>
            <b>You see it, with its page</b>
            <span>Side by side, in plain English, ordered by what matters most.</span>
          </li>
        </ol>
        <div className={s.promise}>
          <div>
            <h3>What you can count on</h3>
            <ul>
              {[
                "Every fact on screen comes from your document, with its page.",
                '"Not covered" and "not mentioned" are never mixed up.',
                "Every insurance term is explained where it appears.",
              ].map((t) => (
                <li key={t}>
                  <Check size={18} strokeWidth={3} aria-hidden className={s.yesIc} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>What we won&apos;t do</h3>
            <ul>
              {["Tell you which plan to buy, or sell you one.", "Fill gaps with guesses.", "Keep your documents after 24 hours."].map(
                (t) => (
                  <li key={t}>
                    <X size={18} strokeWidth={3} aria-hidden className={s.noIc} />
                    {t}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
