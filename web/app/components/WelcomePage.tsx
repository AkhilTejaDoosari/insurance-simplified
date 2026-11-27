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
          className="composition"
          aria-label="Illustrative policy review, not an analysis of your documents"
        >
          <div className="halo" />
          <div className="dots" />
          <div className="paper">
            <div className="paperhead">
              <span>Illustrative policy review</span>
              <span>01 / 03</span>
            </div>
            <h3>
              Before you choose,
              <br />
              know the details.
            </h3>
            <div className="fact">
              <span>Deductible</span>
              <b>Check selected option</b>
            </div>
            <div className="fact">
              <span>Coverage limit</span>
              <b>Verify policy maximum</b>
            </div>
            <div className="fact">
              <span>Exclusions</span>
              <b>Read before enrolling</b>
            </div>
            <div className="source">
              Each finding should connect back to the original policy. If we
              can&apos;t verify something, we&apos;ll say so.
            </div>
          </div>
          <div className="floatnote">
            <span aria-hidden="true">●</span> &nbsp;Evidence, not guesswork
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
