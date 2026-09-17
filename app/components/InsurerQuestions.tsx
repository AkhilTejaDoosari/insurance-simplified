"use client";

import type { InsurerQuestion } from "@/app/lib/extraction/insurer-questions";

export default function InsurerQuestions({
  questions,
}: {
  questions: InsurerQuestion[];
}) {
  if (questions.length === 0) return null;
  return (
    <section className="card" aria-label="Questions to ask your insurer">
      <h2>Questions to ask your insurer</h2>
      <p className="text-muted">Based on gaps and ambiguities found in your documents.</p>
      <ul className="list">
        {questions.map((q) => (
          <li key={q.motivatingFact}>
            {q.questionText}
            <small className="questions__meta">
              About {q.motivatingFact}: {q.triggeringVerdict}
              {q.documentIds.length > 0 ? ` in ${q.documentIds.join(", ")}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
