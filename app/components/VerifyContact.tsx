"use client";

import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
import {
  contactHref,
  groupContactsByPlan,
  type ContactHit,
} from "@/app/lib/extraction/contacts";
import { buildVerifyItems } from "@/app/lib/extraction/verify-items";
import { documentUrl } from "@/app/lib/document-url";
import { planDocuments } from "@/app/lib/extraction/selection";

const ABSENCE_TEXT = "No contact information found in the uploaded documents.";

export default function VerifyContact({
  table,
  sessionId,
  contacts,
  planNames,
  orderedPlanTitles,
  selectedPlanIds,
}: {
  table: Table;
  sessionId: string;
  contacts: ContactHit[];
  planNames: Map<string, { name: string; source: "verified" | "unconfirmed" }>;
  /** Current comparison order of plan titles; contact cards follow it. */
  orderedPlanTitles?: string[];
  selectedPlanIds?: string[];
}) {
  const filenameOf = (documentId: string): string =>
    table.documents.find((doc) => doc.documentId === documentId)?.filename ??
    documentId;
  const planNameOf = (documentId: string): string =>
    planNames.get(documentId)?.name ?? documentId;
  const items = buildVerifyItems(table.rows, table.documents, planNameOf);
  const ungroupedCards = groupContactsByPlan(contacts, planNameOf);
  // Contact cards respect the current plan order when one is provided;
  // unlisted titles keep their provenance order at the end.
  const legacyCards =
    orderedPlanTitles && orderedPlanTitles.length > 0
      ? ungroupedCards
          .map((card, index) => ({
            card,
            index,
            rank: orderedPlanTitles.indexOf(card.planName),
          }))
          .sort((a, b) => {
            const rankA = a.rank === -1 ? orderedPlanTitles.length : a.rank;
            const rankB = b.rank === -1 ? orderedPlanTitles.length : b.rank;
            return rankA === rankB ? a.index - b.index : rankA - rankB;
          })
          .map(({ card }) => card)
      : ungroupedCards;
  const cards = selectedPlanIds
    ? selectedPlanIds.map((id, index) => {
        const sourceIds = table.plans?.some((plan) => plan.planId === id)
          ? planDocuments(table, id)
          : [id];
        const name = orderedPlanTitles?.[index] ?? planNameOf(id);
        const sourced = contacts.filter(
          (contact) =>
            sourceIds.includes(contact.documentId) &&
            contact.quote.includes(contact.value) &&
            contact.page >= 1 &&
            contact.page <=
              (table.documents.find(
                (doc) => doc.documentId === contact.documentId,
              )?.pageCount ?? 0),
        );
        const grouped = groupContactsByPlan(sourced, () => name);
        return (
          grouped[0] ?? { planName: name, documentIds: sourceIds, contacts: [] }
        );
      })
    : legacyCards;

  return (
    <div className="reviewPanel verify">
      <details className="verify__checks" aria-label="Verify before enrolling">
        <summary>Verify before enrolling · unresolved details</summary>
        {items.length === 0 ? (
          <p className="text-muted">
            No additional checks identified here. Review applicability warnings
            and original policy conditions before enrolling.
          </p>
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
                        filenameOf(item.citation.documentId),
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
      </details>

      <section className="verify__block" aria-label="Contact the plan">
        <div className="reviewTopline">
          <div>
            <span className="eyelabel">Practical details</span>
            <h2>Contact the plan</h2>
          </div>
        </div>
        <p className="reviewNote">
          Contacts from the original source documents. A shared brochure contact
          does not establish plan eligibility or benefits.
        </p>
        {cards.length === 0 ? (
          <p className="text-muted" role="status">
            Contact information not verified. {ABSENCE_TEXT}
          </p>
        ) : (
          <div
            className="contacts"
            style={{ "--contact-count": cards.length } as React.CSSProperties}
          >
            {cards.map((card, index) => (
              <div key={`${card.planName}:${index}`} className="contactItem">
                <h3>{card.planName}</h3>
                {card.contacts.length === 0 ? (
                  <p className="text-muted" role="status">
                    Contact information not verified. {ABSENCE_TEXT}
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
