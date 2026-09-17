"use client";

import { useState } from "react";
import ContextInputs, {
  combineCoverageDates,
  combineLocation,
  resolveVisaOrStatus,
  DEFAULT_COUNTRY,
} from "@/app/components/ContextInputs";
import { buildChecklist, type CollectionChecklist } from "@/app/lib/checklist";

export default function ChecklistFlow({
  onHaveDocuments,
}: {
  onHaveDocuments: () => void;
}) {
  const [context, setContext] = useState<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  const [list, setList] = useState<CollectionChecklist | null>(null);

  function build() {
    const visaOrStatus = resolveVisaOrStatus(context);
    const location = combineLocation(context);
    const coverageDates = combineCoverageDates(context);
    setList(
      buildChecklist({ ...context, visaOrStatus, location, coverageDates }),
    );
  }

  return (
    <section className="card" aria-label="What to collect">
      <h2>No documents yet? Start here</h2>
      <p className="text-muted">
        Tell us a little about yourself and we&apos;ll list what to ask for.
      </p>
      {!list && (
        <>
          <div style={{ marginTop: 20 }}>
            <ContextInputs
              context={context}
              onChange={setContext}
              visaLabel="Visa / status"
            />
          </div>
          <div className="actions">
            <button className="btn" onClick={build}>
              Build my checklist
            </button>
            <button className="btn--link" onClick={onHaveDocuments}>
              I already have documents
            </button>
          </div>
        </>
      )}
      {list && (
        <>
          <div className="stack" style={{ marginTop: 20 }}>
            <div>
              <h3>What to look for</h3>
              <ul className="list">
                {list.whatToLookFor.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Documents to collect</h3>
              <ul className="list">
                {list.documentsToCollect.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <p>{list.nextStep}</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={onHaveDocuments}>
              I have my documents — upload
            </button>
          </div>
        </>
      )}
    </section>
  );
}
