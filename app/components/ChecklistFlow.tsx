"use client";

import { useState } from "react";
import { buildChecklist, type CollectionChecklist } from "@/app/lib/checklist";

const FIELDS = [
  { name: "age", label: "Age" },
  { name: "countryOrResidency", label: "Country / residency" },
  { name: "visaOrStatus", label: "Visa / status" },
  { name: "location", label: "Location" },
  { name: "coverageDates", label: "Coverage dates" },
] as const;

export default function ChecklistFlow({ onHaveDocuments }: { onHaveDocuments: () => void }) {
  const [context, setContext] = useState<Record<string, string>>({});
  const [list, setList] = useState<CollectionChecklist | null>(null);

  return (
    <section aria-label="What to collect">
      <h2>No documents yet? Start here</h2>
      {!list && (
        <>
          {FIELDS.map(({ name, label }) => (
            <label key={name} style={{ display: "block", marginTop: 8 }}>
              {label}{" "}
              <input
                value={context[name] ?? ""}
                onChange={(e) => setContext({ ...context, [name]: e.target.value })}
              />
            </label>
          ))}
          <button onClick={() => setList(buildChecklist(context))} style={{ marginTop: 12 }}>
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
