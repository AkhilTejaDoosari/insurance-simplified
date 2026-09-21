"use client";

import { useState } from "react";
import UploadDropzone, { type UploadResult } from "@/app/components/UploadDropzone";
import ComparisonTable from "@/app/components/ComparisonTable";
import ChatPanel from "@/app/components/ChatPanel";
import ChecklistFlow from "@/app/components/ChecklistFlow";
import WelcomePage from "@/app/components/WelcomePage";
import { DEFAULT_COUNTRY } from "@/app/components/ContextInputs";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

type Page = "welcome" | "upload" | "checklist" | "results";

export default function Home() {
  const [page, setPage] = useState<Page>("welcome");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A-008: intake context is shared so Guided Intake → Document Intake
  // reuses previously supplied values instead of starting blank.
  const [sharedContext, setSharedContext] = useState<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  // Context actually submitted with the upload; passed to Results so
  // NEEDS YOUR INPUT can ask only for what is still missing (A-022).
  const [sessionContext, setSessionContext] = useState<Record<string, string>>({});

  async function handleUploaded(result: UploadResult, context: Record<string, string>) {
    setSessionId(result.sessionId);
    setSessionContext({ ...context });
    setSharedContext({ ...context });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error?.message ?? data.error ?? "Extraction failed";
        throw new Error(message);
      }
      setTable(data as Table);
      setPage("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
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
      {busy && (
        <p className="notice" role="status">
          Extracting comparison…
        </p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
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
            This session is temporary. Closing this page deletes your documents
            unless you download an export.{" "}
            <a href={`/api/export?sessionId=${sessionId}`} download>
              Download export (JSON)
            </a>
          </p>
        </>
      )}
    </main>
  );
}
