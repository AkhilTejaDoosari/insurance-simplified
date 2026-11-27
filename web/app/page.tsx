"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import UploadDropzone, {
  type UploadResult,
} from "@/app/components/UploadDropzone";
import AdaptiveResults from "@/app/components/AdaptiveResults";
import PolicyViewControls from "@/app/components/PolicyViewControls";
import ChatPanel, {
  type ChatSelectionPayload,
} from "@/app/components/ChatPanel";
import WelcomePage from "@/app/components/WelcomePage";
import {
  DEFAULT_COUNTRY,
  toCanonicalContext,
} from "@/app/components/ContextInputs";
import {
  describeExtractFailure,
  type ExtractFailure,
} from "@/app/lib/extract-errors";
import type { ContactHit } from "@/app/lib/extraction/contacts";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";
import {
  createSelection,
  moveSelectedPlan,
  reconcileSelection,
  resetPlanOrder,
  selectTier,
  setSelectedPlanIds,
  type EffectiveSelection,
} from "@/app/lib/extraction/selection";
import { documentPlanTitle } from "@/app/lib/extraction/plan-names";
import {
  viewDocumentIds,
  type ActiveView,
} from "@/app/lib/presentation/adaptive";

type Page = "welcome" | "upload" | "checklist" | "results";

/** Human label of the currently selected plans × tiers (chat task 18): used
 *  to mark chat turns as historical when the selection changes afterwards.
 *  Titles come only from verified plan identities / document titles — never
 *  filenames. */
function chatScopeLabel(table: Table, selection: EffectiveSelection): string {
  return selection.selectedPlanIds
    .map((planId) => {
      const verified = table.plans?.find((p) => p.planId === planId);
      const title = verified?.name ?? documentPlanTitle(table, planId).name;
      const tier =
        selection.tiers[planId] ?? selection.legacyTiersByDocument[planId];
      return tier ? `${title} (${tier})` : title;
    })
    .join(", ");
}

// module scope: validated client-selection payload shared by the chat panel
// and the export download (M5: one selection contract for both features).
function selectionPayload(
  selection: EffectiveSelection,
  view: ActiveView,
): ChatSelectionPayload {
  return {
    resultFingerprint: selection.resultFingerprint,
    planIds: view.planIds,
    tiers: view.tiers,
    legacyTiersByDocument: {},
    viewMode: view.mode,
    ...(view.mode === "understand" ? { documentId: view.documentId } : {}),
    selectionKey: JSON.stringify([
      selection.resultFingerprint,
      selection.contextVersion,
      view,
    ]),
  };
}

export default function Home() {
  const [page, setPage] = useState<Page>("welcome");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const pageRef = useRef<Page>("welcome");
  const [table, setTable] = useState<Table | null>(null);
  const [selection, setSelection] = useState<EffectiveSelection | null>(null);
  const [viewMode, setViewMode] = useState<ActiveView["mode"]>("understand");
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [readings, setReadings] = useState<Record<string, ActiveView>>({});
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutTrigger = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<Table | null>(null);
  const requestSequence = useRef(0);
  const contextRequestSequence = useRef(0);
  const contextRequestPending = useRef(false);
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [extractError, setExtractError] = useState<ExtractFailure | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const [chatDraft, setChatDraft] = useState<{ text: string; key: number }>();
  const [busy, setBusy] = useState(false);
  // A-008: intake context is shared so Guided Intake → Document Intake
  // reuses previously supplied values instead of starting blank.
  const [sharedContext, setSharedContext] = useState<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  const sharedContextRef = useRef<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  const submittedIntakeRef = useRef<Record<string, string> | null>(null);
  // Context actually submitted with the upload; passed to Results so
  // NEEDS YOUR INPUT can ask only for what is still missing (A-022).
  const [sessionContext, setSessionContext] = useState<Record<string, string>>(
    {},
  );

  function intakeChanged(): boolean {
    return (
      submittedIntakeRef.current !== null &&
      JSON.stringify(toCanonicalContext(sharedContextRef.current)) !==
        JSON.stringify(submittedIntakeRef.current)
    );
  }

  function updateIntake(next: Record<string, string>) {
    sharedContextRef.current = next;
    setSharedContext(next);
  }

  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, appPage: "welcome" },
      "",
    );
    const onBack = (event: PopStateEvent) => {
      const requested = event.state?.appPage as Page | undefined;
      const next =
        requested === "results" && (!tableRef.current || intakeChanged())
          ? "upload"
          : (requested ?? "welcome");
      pageRef.current = next;
      setPage(next);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);

  function navigate(next: Page) {
    window.history.pushState({ ...window.history.state, appPage: next }, "");
    pageRef.current = next;
    setPage(next);
    if (next === "results" || next === "welcome") window.scrollTo({ top: 0 });
    else
      requestAnimationFrame(() =>
        document.getElementById("start")?.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        }),
      );
  }

  async function runExtract(activeSessionId: string) {
    const request = ++requestSequence.current;
    contextRequestSequence.current++;
    contextRequestPending.current = false;
    setBusy(true);
    setExtractError(null);
    tableRef.current = null;
    setTable(null);
    setSelection(null);
    pageRef.current = "upload";
    setPage("upload");
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: activeSessionId }),
      });
      const data = await res.json().catch(() => null);
      if (
        request !== requestSequence.current ||
        activeSessionRef.current !== activeSessionId
      )
        return;
      if (intakeChanged()) {
        activeSessionRef.current = null;
        setSessionId(null);
        setExtractError({
          message:
            "Your details changed while we were reading. Upload again to refresh your results.",
          retryable: false,
        });
        return;
      }
      if (!res.ok) {
        setExtractError(describeExtractFailure(data, null, res.status));
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          activeSessionRef.current = null;
          setSessionId(null);
        }
        return;
      }
      setExtractError(null);
      setTable(data as Table);
      setActiveDocumentId((data as Table).documents[0]?.documentId ?? "");
      setReadings({});
      setViewMode("understand");
      setChatOpen(false);
      tableRef.current = data as Table;
      setSelection(
        createSelection(
          data as Table,
          (data as Table).resultFingerprint ?? "legacy",
        ),
      );
      setContacts(
        Array.isArray((data as { contacts?: unknown }).contacts)
          ? ((data as { contacts: ContactHit[] }).contacts ?? [])
          : [],
      );
      if (pageRef.current === "upload") navigate("results");
    } catch {
      if (request === requestSequence.current)
        setExtractError(describeExtractFailure(null, true));
    } finally {
      if (request === requestSequence.current) setBusy(false);
    }
  }

  async function handleUploaded(
    result: UploadResult,
    context: Record<string, string>,
  ) {
    activeSessionRef.current = result.sessionId;
    setSessionId(result.sessionId);
    setSessionContext(toCanonicalContext(context));
    submittedIntakeRef.current = toCanonicalContext(context);
    updateIntake({ ...context });
    await runExtract(result.sessionId);
  }

  async function retryExtract() {
    if (sessionId && !busy) await runExtract(sessionId);
  }

  // M5 task 19: the export is a same-origin POST carrying the validated
  // selection; the response is downloaded as a blob so the file never flows
  // through a URL the user could paste elsewhere.
  async function downloadPdf() {
    if (busy || !selection || !sessionId) return;
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId,
          selection: selectionPayload(selection, activeView),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        } | null;
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          activeSessionRef.current = null;
          setSessionId(null);
          if (pageRef.current === "results") navigate("upload");
          return;
        }
        throw new Error(data?.error?.message ?? "Export failed. Try again.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `insurance-comparison-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Export failed. Try again.",
      );
    }
  }

  function goToUpload() {
    navigate("upload");
  }

  const renderSequence = requestSequence.current;
  const documentId = table?.documents.some(
    (d) => d.documentId === activeDocumentId,
  )
    ? activeDocumentId
    : table?.documents[0]?.documentId;
  const defaultReading: ActiveView = {
    mode: "understand",
    documentId,
    planIds:
      table?.plans
        ?.filter((p) => p.sources.some((s) => s.documentId === documentId))
        .slice(0, 1)
        .map((p) => p.planId) ?? [],
    tiers: {},
  };
  const activeView: ActiveView =
    viewMode === "understand"
      ? (readings[documentId ?? ""] ?? defaultReading)
      : {
          mode: "compare",
          planIds: selection?.selectedPlanIds ?? [],
          tiers: selection?.tiers ?? {},
        };
  function changeActiveView(next: ActiveView) {
    setExportError(null);
    if (next.mode === "understand") {
      if (next.documentId !== activeView.documentId) {
        setActiveDocumentId(next.documentId!);
        setReadings((prior) =>
          prior[next.documentId!]
            ? prior
            : { ...prior, [next.documentId!]: next },
        );
      } else setReadings((prior) => ({ ...prior, [next.documentId!]: next }));
    } else
      setSelection((prior) =>
        prior && table
          ? {
              ...setSelectedPlanIds(prior, table, next.planIds),
              tiers: next.tiers,
            }
          : prior,
      );
  }
  return (
    <main className={`page${page === "results" ? " reviewShell" : ""}`}>
      {page !== "results" && (
        <>
          <WelcomePage
            onChoosePath={(path) =>
              navigate(path === "documents" ? "upload" : "checklist")
            }
          />
          {table && !intakeChanged() && (
            <button
              type="button"
              className="btn--link"
              onClick={() => navigate("results")}
            >
              Return to results
            </button>
          )}
          {table && intakeChanged() && (
            <p role="status" className="notice">
              Your details changed. Upload again to refresh your results.
            </p>
          )}
          <UploadDropzone
            onUploaded={handleUploaded}
            mode={page === "checklist" ? "guided" : "documents"}
            onModeChange={(mode) =>
              navigate(mode === "guided" ? "checklist" : "upload")
            }
            context={sharedContext}
            onContextChange={updateIntake}
            onFilesChanged={() => {
              requestSequence.current++;
              contextRequestSequence.current++;
              contextRequestPending.current = false;
              activeSessionRef.current = null;
              tableRef.current = null;
              setTable(null);
              setSelection(null);
              setSessionId(null);
              setContacts([]);
              setExtractError(null);
              setBusy(false);
            }}
            externalBusy={busy}
            externalBusyLabel="Extracting insurance terms and preparing your results…"
            extractError={extractError?.message ?? null}
            showRetry={extractError?.retryable === true}
            onRetry={() => void retryExtract()}
          />
        </>
      )}
      {page === "results" && table && sessionId && (
        <>
          <div className="reviewModeBar" data-chat-background>
            <div>
              <span className="eyebrow">Your document review</span>
              <p>Two ways to make sense of your coverage.</p>
            </div>
            <div
              className="reviewModes"
              role="group"
              aria-label="Policy reading mode"
            >
              <button
                type="button"
                aria-pressed={viewMode === "understand"}
                onClick={() => {
                  setViewMode("understand");
                  setExportError(null);
                }}
              >
                Understand one policy
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "compare"}
                disabled={(table.plans?.length ?? 0) < 2}
                onClick={() => {
                  setViewMode("compare");
                  setExportError(null);
                }}
              >
                Compare policies
              </button>
            </div>
            <button
              type="button"
              ref={aboutTrigger}
              className="btn btn--secondary"
              aria-expanded={aboutOpen}
              aria-controls="about-insurance"
              onClick={() => setAboutOpen((open) => !open)}
            >
              About
            </button>
          </div>
          {aboutOpen && (
            <section
              id="about-insurance"
              className="reviewPanel adaptiveAbout"
              aria-label="About Insurance Simplified"
              data-chat-background
            >
              <h2>Insurance, in plain sight.</h2>
              <p>
                Understand one uploaded policy, or compare two or three verified
                plans. Switch documents without uploading again.
              </p>
              <p>
                We organize source-backed information, not advice or an
                automatic winner. Missing information is not a denial. A
                brochure may describe several plans or selectable options; it
                does not prove your purchased coverage or eligibility.
              </p>
              <p>
                Open the original PDF to check conditions. Unassigned evidence,
                conflicting statements and uncertain figures need confirmation
                with the insurer. Chat and report downloads follow your active
                view.
              </p>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setAboutOpen(false);
                  aboutTrigger.current?.focus();
                }}
              >
                Close About
              </button>
            </section>
          )}
          <div className="reviewHero" data-chat-background>
            <div>
              <span className="eyebrow">
                Your document review · {table.documents.length}{" "}
                {table.documents.length === 1 ? "document" : "documents"}
              </span>
              <h1>
                {viewMode === "understand"
                  ? "Know what this policy says."
                  : "See the differences. Know what to check."}
              </h1>
              <p>
                {viewMode === "understand"
                  ? "A guided reading of one document. Start with the answers, then check the original wording whenever you need to."
                  : "Compare only what your documents support. Keep the differences, conditions and unanswered questions in view."}
              </p>
            </div>
            <div className="reviewActions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={goToUpload}
              >
                ← Edit details
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void downloadPdf()}
                disabled={busy}
              >
                Download report ↗
              </button>
              <button
                type="button"
                className="btn"
                aria-expanded={chatOpen}
                aria-controls="document-chat"
                onClick={() => setChatOpen(true)}
              >
                Ask a question
              </button>
            </div>
          </div>
          {exportError && (
            <p role="alert" className="alert">
              {exportError}
            </p>
          )}
          <div
            className={`results-workspace${chatOpen ? " results-workspace--chat-open" : ""}`}
          >
            <div className="reviewBody" data-chat-background>
              {viewMode === "understand" && (
                <PolicyViewControls
                  table={table}
                  view={activeView}
                  onChange={changeActiveView}
                />
              )}
              <AdaptiveResults
                key={`${activeView.mode}:${activeView.documentId ?? "comparison"}`}
                view={activeView}
                selectionControls={
                  viewMode === "compare" ? (
                    <PolicyViewControls
                      table={table}
                      view={activeView}
                      onChange={changeActiveView}
                    />
                  ) : undefined
                }
                table={table}
                sessionId={sessionId}
                userContext={sessionContext}
                selectedPlanIds={selection?.selectedPlanIds}
                onSelectedPlanIdsChange={(planIds) =>
                  setSelection((prior) =>
                    prior ? setSelectedPlanIds(prior, table, planIds) : prior,
                  )
                }
                onMovePlan={(planId, direction) =>
                  setSelection((prior) =>
                    prior ? moveSelectedPlan(prior, planId, direction) : prior,
                  )
                }
                onResetPlanOrder={() =>
                  setSelection((prior) =>
                    prior ? resetPlanOrder(prior, table) : prior,
                  )
                }
                tierSelection={selection?.tiers}
                onTierSelectionChange={(planId, tier) => {
                  setSelection((prior) =>
                    prior ? selectTier(prior, table, planId, tier) : prior,
                  );
                }}
                selectedSection={selection?.section}
                onSectionChange={(section) =>
                  setSelection((prior) =>
                    prior ? { ...prior, section } : prior,
                  )
                }
                onContextRequestStart={() => {
                  if (contextRequestPending.current) return null;
                  contextRequestPending.current = true;
                  return ++contextRequestSequence.current;
                }}
                onContextRequestEnd={(generation) => {
                  if (generation === contextRequestSequence.current) {
                    contextRequestPending.current = false;
                  }
                }}
                onContextRequestFailure={(failure, generation, status) => {
                  if (
                    activeSessionRef.current !== sessionId ||
                    requestSequence.current !== renderSequence ||
                    generation !== contextRequestSequence.current
                  )
                    return;
                  tableRef.current = null;
                  setTable(null);
                  setSelection(null);
                  setContacts([]);
                  setExtractError(failure);
                  if (status === 401 || status === 403 || status === 404) {
                    activeSessionRef.current = null;
                    setSessionId(null);
                  }
                  if (pageRef.current === "results") navigate("upload");
                }}
                onContextUpdate={(next, generation) => {
                  if (
                    activeSessionRef.current === sessionId &&
                    requestSequence.current === renderSequence &&
                    generation === contextRequestSequence.current
                  ) {
                    setSessionContext((prior) => ({ ...prior, ...next }));
                  }
                }}
                onTableUpdate={(next, nextContacts, generation) => {
                  if (
                    activeSessionRef.current !== sessionId ||
                    requestSequence.current !== renderSequence ||
                    generation !== contextRequestSequence.current
                  )
                    return;
                  setTable(next);
                  tableRef.current = next;
                  setSelection((prior) =>
                    prior
                      ? {
                          ...reconcileSelection(
                            prior,
                            next,
                            next.resultFingerprint ?? prior.resultFingerprint,
                            { contextOnly: true },
                          ),
                          contextVersion: prior.contextVersion + 1,
                        }
                      : createSelection(
                          next,
                          next.resultFingerprint ?? "legacy",
                        ),
                  );
                  if (nextContacts !== undefined) setContacts(nextContacts);
                }}
                contacts={contacts}
                onAskFact={(text) => {
                  setChatDraft({ text, key: Date.now() });
                  setChatOpen(true);
                }}
              />
            </div>
            <aside
              id="document-chat"
              hidden={!chatOpen}
              className="results-workspace__chat"
              aria-label={
                table.documents.length === 1
                  ? "Ask about your document"
                  : "Ask about your plans"
              }
            >
              <ChatPanel
                open={chatOpen}
                onClose={closeChat}
                draft={chatDraft}
                sessionId={sessionId}
                documents={table.documents.filter((d) =>
                  viewDocumentIds(table, activeView).includes(d.documentId),
                )}
                selection={
                  selection
                    ? selectionPayload(selection, activeView)
                    : undefined
                }
                scopeLabel={
                  activeView.mode === "understand"
                    ? `${table.documents.find((d) => d.documentId === activeView.documentId)?.filename ?? "Document"}${activeView.planIds[0] ? ` · ${table.plans?.find((p) => p.planId === activeView.planIds[0])?.name}` : " · document evidence"}${activeView.tiers[activeView.planIds[0]] ? ` (${activeView.tiers[activeView.planIds[0]]})` : ""}`
                    : selection
                      ? chatScopeLabel(table, selection)
                      : undefined
                }
              />
            </aside>
          </div>
          {!chatOpen && (
            <button
              type="button"
              className="chatFloat"
              aria-expanded={false}
              aria-controls="document-chat"
              onClick={() => setChatOpen(true)}
            >
              Ask a question <span aria-hidden="true">↗</span>
            </button>
          )}
          <p className="notice" data-chat-background>
            This session is temporary. Closing this page deletes your documents.
          </p>
        </>
      )}
    </main>
  );
}
