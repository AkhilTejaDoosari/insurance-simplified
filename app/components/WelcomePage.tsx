"use client";

import { useState } from "react";

type Path = "documents" | "guided";

export default function WelcomePage({
  onChoosePath,
}: {
  onChoosePath: (path: Path) => void;
}) {
  return (
    <main className="page welcome">
      <header className="welcome__hero">
        <h1>Insurance Simplified</h1>
        <p className="welcome__tagline">
          Compare plans side by side, with every claim traced to the page it came from.
        </p>
      </header>

      <section className="welcome__explanation" aria-label="What this does">
        <p>
          Insurance documents contain many details, but only some materially affect your
          decision. Insurance Simplified helps you:
        </p>
        <ul className="welcome__benefits">
          <li>Identify the differences that matter</li>
          <li>Compare them across plans</li>
          <li>Understand what&apos;s uncertain</li>
          <li>Ask questions and get cited answers</li>
          <li>Verify important claims against the original documents</li>
        </ul>
      </section>

      <div className="welcome__choices" role="group" aria-label="Choose your starting path">
        <button
          className="welcome__choice"
          onClick={() => onChoosePath("documents")}
          type="button"
        >
          <span className="welcome__choice-icon" aria-hidden="true">📄</span>
          <div className="welcome__choice-content">
            <h2>I have my documents</h2>
            <p>Upload 2–4 insurance PDFs and compare them now</p>
          </div>
        </button>

        <button
          className="welcome__choice"
          onClick={() => onChoosePath("guided")}
          type="button"
        >
          <span className="welcome__choice-icon" aria-hidden="true">🔍</span>
          <div className="welcome__choice-content">
            <h2>I don&apos;t know where to start</h2>
            <p>Get a checklist of what to collect and what to look for</p>
          </div>
        </button>
      </div>

      <p className="welcome__note">
        Nothing is stored after you close the page. Saving means downloading an export file.
      </p>
    </main>
  );
}