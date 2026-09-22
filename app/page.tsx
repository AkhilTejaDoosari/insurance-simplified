"use client";

import { useState } from "react";
import UploadDropzone, { type UploadResult } from "@/app/components/UploadDropzone";
import ComparisonTable from "@/app/components/ComparisonTable";
import ChatPanel from "@/app/components/ChatPanel";
import ChecklistFlow from "@/app/components/ChecklistFlow";
import WelcomePage from "@/app/components/WelcomePage";
import { DEFAULT_COUNTRY, toCanonicalContext } from "@/app/components/ContextInputs";
import {
  describeExtractFailure,
  type ExtractFailure,
} from "@/app/lib/extract-errors";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

type Page = "welcome" | "upload" | "checklist" | "results";

export default function Home() {
  const [page, setPage] = useState<Page>("welcome");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [extractError, setExtractError] = useState<ExtractFailure | null>(null);
  const [busy, setBusy] = useState(false);
  // A-008: intake context is shared so Guided Intake → Document Intake
  // reuses previously supplied values instead of starting blank.
  const [sharedContext, setSharedContext] = useState<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  // Context actually submitted with the upload; passed to Results so
  // NEEDS YOUR INPUT can ask only for what is still missing (A-022).
  const [sessionContext, setSessionContext] = useState<Record<string, string>>({});

  async function runExtract(activeSessionId: string) {
    setBusy(true);
    setExtractError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: activeSessionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setExtractError(describeExtractFailure(data));
        return;
      }
      setExtractError(null);
      setTable(data as Table);
      setPage("results");
    } catch {
      setExtractError(describeExtractFailure(null, true));
    } finally {
      setBusy(false);
    }
  }

  async function handleUploaded(result: UploadResult, context: Record<string, string>) {
    setSessionId(result.sessionId);
    setSessionContext(toCanonicalContext(context));
    setSharedContext({ ...context });
    await runExtract(result.sessionId);
  }

  async function retryExtract() {
    if (sessionId && !busy) await runExtract(sessionId);
  }

  function goToUpload() {
    setPage("upload");
  }

  return (
    <main className="page">
      {page === "welcome" && (
        <WelcomePage onChoosePath={(path) => (path === "documents" ? setPage("upload") : setPage("checklist"))} />
      )}
      {page === "upload" && !table && (
        <>
          <UploadDropzone
            onUploaded={handleUploaded}
            context={sharedContext}
            onContextChange={setSharedContext}
            externalBusy={busy}
            externalBusyLabel="Building your comparison…"
            extractError={extractError?.message ?? null}
            showRetry={extractError?.retryable === true}
            onRetry={() => void retryExtract()}
          />
          <p className="notice">
            Still waiting on your plan documents?{" "}
            <button className="btn--link" onClick={() => setPage("checklist")}>
              I don&apos;t have documents yet
            </button>
          </p>
        </>
      )}
      {page === "checklist" && !table && (
        <ChecklistFlow
          onHaveDocuments={() => goToUpload()}
          context={sharedContext}
          onContextChange={setSharedContext}
        />
      )}
      {page === "results" && table && sessionId && (
        <>
          <div className="results-workspace">
            <ComparisonTable
              table={table}
              sessionId={sessionId}
              userContext={sessionContext}
              onContextUpdate={setSessionContext}
              onTableUpdate={setTable}
            />
            <aside className="results-workspace__chat" aria-label="Ask about your plans">
              <ChatPanel sessionId={sessionId} documents={table.documents} />
            </aside>
          </div>
          <p className="notice">
            This session is temporary. Closing this page deletes your documents.
          </p>
        </>
      )}
    </main>
  );
}
