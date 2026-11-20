"use client";

// Renders the issued evidence surfaces (surface-types.ts) exactly as given:
// per plan, the exclusions read (verbatim, each with its page link) and the
// reading state in plain words; and which document governs a scope, or
// CONFLICTED with its reasons. A view that cannot be confirmed shows that
// phrase and no values. An empty list is never worded "No exclusions".

import React from "react";
import VerdictBadge from "@/app/components/VerdictBadge";
import { documentUrl } from "@/app/lib/document-url";
import {
  AUTHORITY_HEADING,
  EXCLUSIONS_HEADING,
  surfacesDisplay,
  type SurfaceLink,
} from "@/app/lib/presentation/adaptive";
import type { EvidenceSurfaces as Surfaces } from "@/app/lib/evidence/surface-types";
import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";

function PageLinks({ sessionId, links, subject }: { sessionId: string; links: SurfaceLink[]; subject: string }) {
  return (
    <>
      {links.map((l, i) => (
        <React.Fragment key={`${l.documentId}-${l.page}-${i}`}>
          {i > 0 ? ", " : ""}
          <a
            href={documentUrl(sessionId, l.documentId, l.filename, l.page, l.evidenceId)}
            target="_blank"
            rel="noopener"
            aria-label={`${subject}: open ${l.filename} at page ${l.page}`}
          >
            {l.filename}, page {l.page}
          </a>
        </React.Fragment>
      ))}
    </>
  );
}

export default function EvidenceSurfaces({
  table,
  surfaces,
  sessionId,
  documentIds,
}: {
  table: Pick<RegisteredComparisonTable, "documents">;
  surfaces: Surfaces | null;
  sessionId: string;
  documentIds?: readonly string[];
}) {
  const display = surfacesDisplay(table, surfaces, documentIds);
  if (!display.exclusions.length && !display.authority.length) return null;
  return (
    <section className="adaptiveBlock adaptiveSurfaces" aria-label="Exclusions read and which document governs">
      {display.exclusions.length > 0 && (
        <div className="adaptiveExclusions">
          <h3>{EXCLUSIONS_HEADING}</h3>
          {display.exclusions.map((x, i) =>
            x.kind === "cannot-be-confirmed" ? (
              <p key={`cbc-${i}`} role="note" data-status={x.status}>
                <VerdictBadge verdict="NEEDS VERIFICATION" /> {x.text}
              </p>
            ) : (
              <div key={`${x.documentId}-${x.planId}`} className="adaptiveExclusionPlan" data-coverage={x.coverage}>
                <h4>
                  {x.planName} <span className="text-muted">({x.filename})</span>
                </h4>
                <p className={x.coverage === "complete" ? "text-muted" : undefined} role={x.coverage === "complete" ? undefined : "note"}>
                  {x.coverageText}
                </p>
                {x.emptyText && <p>{x.emptyText}</p>}
                {x.items.length > 0 && (
                  <ul className="list">
                    {x.items.map((item) => (
                      <li key={item.provisionId}>
                        <q>{item.claim}</q>{" "}
                        <span className="text-muted">
                          (<PageLinks sessionId={sessionId} links={item.links} subject={`Exclusion in ${x.planName}`} />)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}
        </div>
      )}
      {display.authority.length > 0 && (
        <div className="adaptiveAuthority">
          <h3>{AUTHORITY_HEADING}</h3>
          <ul className="list">
            {display.authority.map((a, i) =>
              a.kind === "cannot-be-confirmed" ? (
                <li key={`cbc-${i}`} role="note" data-status={a.status}>
                  <VerdictBadge verdict="NEEDS VERIFICATION" /> {a.text}
                </li>
              ) : (
                <li key={`${a.scopeLabel}-${i}`} data-status={a.status}>
                  {a.verdict && <VerdictBadge verdict={a.verdict} />} {a.text}
                  {a.reasons.length > 0 && (
                    <>
                      {" "}
                      <span>Why: {a.reasons.join("; ")}.</span>
                    </>
                  )}
                  {a.relations.length > 0 && (
                    <ul className="list">
                      {a.relations.map((r, j) => (
                        <li key={j}>
                          {r.text}
                          {r.links.map((l, k) => (
                            <span key={k}>
                              {" "}
                              <q>{l.quote}</q>{" "}
                              <span className="text-muted">
                                (<PageLinks sessionId={sessionId} links={[l]} subject={a.scopeLabel} />)
                              </span>
                            </span>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
