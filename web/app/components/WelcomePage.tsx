"use client";

type Path = "documents" | "guided";

export default function WelcomePage({
  onChoosePath,
}: {
  onChoosePath: (path: Path) => void;
}) {
  return (
    <div className="welcome">
      <section className="hero">
        <div>
          <span className="eyebrow">A clearer way to read insurance</span>
          <h1>
            Understand what your insurance actually <em>covers.</em>
          </h1>
          <p className="lede">
            Insurance documents can be hard to make sense of. Bring yours here
            and get a clear breakdown of costs, exclusions, and the questions
            worth asking.
          </p>
          <div className="heroActions">
            <button className="btn" onClick={() => onChoosePath("documents")}>
              I have my documents <span aria-hidden="true">↗</span>
            </button>
            <button
              className="btn btn--secondary"
              onClick={() => onChoosePath("guided")}
            >
              I don&apos;t know where to start <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="assurance">
            <span className="dot" />A document-first tool. Important
            uncertainties stay visible.
          </div>
        </div>
        <div
          className="lsheetwrap"
          role="img"
          aria-label="Example, not your document: a plan excerpt with highlighted phrases and their plain-English explanations"
        >
          <div className="lsheet">
            <div className="lsheet__title">Campus Care Student Health Plan</div>
            <div className="lsheet__meta">Example document, excerpt</div>
            <p>
              Section 4. Deductible. The Insured Person must satisfy the{" "}
              <span className="lsweep">Deductible of $250 per Injury or Sickness</span>{" "}
              before benefits are payable. The Deductible applies separately to
              each covered Injury or Sickness.
            </p>
            <p>
              Section 5. Limitations.{" "}
              <span className="lsweep lsweep--two">
                Pre-existing conditions are excluded for the first 12 months
              </span>{" "}
              of continuous coverage under this Policy.
            </p>
            <p>
              All benefits are subject to the Schedule of Benefits and the terms
              of the Policy.
            </p>
          </div>
          <div className="lmargin">
            <div className="lnote lnote--one">
              <b>In plain words</b>You pay $250 for each new illness or injury. A
              second, separate illness means another $250.
              <span className="lnote__src">Page 2 of the example</span>
            </div>
            <div className="lnote lnote--two">
              <b>In plain words</b>Health problems you already had aren&apos;t
              covered during your first 12 months.
              <span className="lnote__src">Page 9 of the example</span>
            </div>
          </div>
        </div>
      </section>
      <div className="mini-tiles">
        <div className="minitile">
          <strong>Find the important details</strong>Costs, coverage,
          restrictions, and missing information.
        </div>
        <div className="minitile">
          <strong>Keep the original nearby</strong>Trace statements back to the
          page they came from.
        </div>
        <div className="minitile">
          <strong>Ask a follow-up</strong>Questions stay alongside your
          analysis, not in another section.
        </div>
      </div>
    </div>
  );
}
