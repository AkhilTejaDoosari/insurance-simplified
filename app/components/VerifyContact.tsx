"use client";

import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
import {
  contactHref,
  groupContactsByPlan,
  type ContactHit,
} from "@/app/lib/extraction/contacts";
import { buildVerifyItems } from "@/app/lib/extraction/verify-items";
import { documentUrl } from "@/app/lib/document-url";

const ABSENCE_TEXT = "No contact information found in the uploaded documents.";

export default function VerifyContact({
  table,
  sessionId,
  contacts,
  planNames,
}: {
  table: Table;
  sessionId: string;
  contacts: ContactHit[];
  planNames: Map<string, { name: string; source: "extracted" | "filename" }>;
}) {
  const planNameOf = (documentId: string): string =>
    planNames.get(documentId)?.name ?? documentId;
  const items = buildVerifyItems(
    table.rows,
    table.documents,
    planNameOf,
  );
  const cards = groupContactsByPlan(contacts, planNameOf);

  return (
    <div className="verify">
      <section className="card verify__block" aria-label="Verify before enrolling">
        <h2>Verify before enrolling</h2>
        {items.length === 0 ? (
          <p className="text-muted">Nothing unresolved — every core fact is stated and verified.</p>
        ) : (
          <ul className="list">
            {items.map((item, i) => (
              <li key={`${item.factName}:${item.documentId ?? "all"}:${i}`}>
                {item.text}
                {item.citation && item.documentId && (
                  <>
                    {" "}
                    <a
                      href={documentUrl(
                        sessionId,
                        item.citation.documentId,
                        planNameOf(item.citation.documentId),
                        item.citation.page,
                        item.citation.evidenceId,
                      )}
                      target="_blank"
                      rel="noopener"
                    >
                      View evidence
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card verify__block" aria-label="Contact the plan">
        <h2>Contact the plan</h2>
        {cards.length === 0 ? (
          <p className="text-muted" role="status">
            {ABSENCE_TEXT}
          </p>
        ) : (
          cards.map((card) => (
            <div key={card.planName} className="verify__card">
              <h3>{card.planName}</h3>
              {card.contacts.length === 0 ? (
                <p className="text-muted" role="status">
                  {ABSENCE_TEXT}
                </p>
              ) : (
                <ul className="list">
                  {card.contacts.map((contact, j) => {
                    const href = contactHref(contact.kind, contact.value);
                    const primary = contact.evidence[0];
                    return (
                      <li key={`${contact.kind}:${contact.value}:${j}`}>
                        {contact.label}:{" "}
                        {href ? (
                          <a href={href} target="_blank" rel="noopener">
                            {contact.value}
                          </a>
                        ) : (
                          <span>{contact.value}</span>
                        )}
                        {primary && (
                          <>
                            {" "}
                            <a
                              href={documentUrl(
                                sessionId,
                                primary.documentId,
                                primary.filename,
                                primary.page,
                              )}
                              target="_blank"
                              rel="noopener"
                              title={`Source: ${primary.filename}, page ${primary.page} — “${primary.quote}”`}
                            >
                              Source
                            </a>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
