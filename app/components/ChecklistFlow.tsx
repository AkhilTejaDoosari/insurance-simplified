"use client";

import { useState } from "react";
import ContextInputs, {
  combineCoverageDates,
  combineLocation,
  resolveVisaOrStatus,
  DEFAULT_COUNTRY,
} from "@/app/components/ContextInputs";
import { buildChecklist, type CollectionChecklist } from "@/app/lib/checklist";

export default function ChecklistFlow({ onHaveDocuments }: { onHaveDocuments: () => void }) {
  const [context, setContext] = useState<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  const [list, setList] = useState<CollectionChecklist | null>(null);

  function build() {
    const visaOrStatus = resolveVisaOrStatus(context);
    const location = combineLocation(context);
    const coverageDates = combineCoverageDates(context);
    setList(buildChecklist({ ...context, visaOrStatus, location, coverageDates }));
  }

  return (
    <section aria-label="What to collect">
      <h2>No documents yet? Start here</h2>
      {!list && (
        <>
          <ContextInputs
            context={context}
            onChange={setContext}
            visaLabel="Visa / status"
          />
          <button onClick={build} style={{ marginTop: 12 }}>
            Build my checklist
          </button>
        </>
      )}
      {list && (
        <>
          <h3>What to look for</h3>
          <ul>
            {list.whatToLookFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h3>Documents to collect</h3>
          <ul>
            {list.documentsToCollect.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>{list.nextStep}</p>
          <button onClick={onHaveDocuments}>I have my documents — upload</button>
        </>
      )}
    </section>
  );
}
