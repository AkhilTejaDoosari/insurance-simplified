"use client";

import { useMemo, useState } from "react";
import UploadDropzone, { type UploadResult } from "@/app/components/UploadDropzone";
import ComparisonTable from "@/app/components/ComparisonTable";
import ChatPanel from "@/app/components/ChatPanel";
import InsurerQuestions from "@/app/components/InsurerQuestions";
import ChecklistFlow from "@/app/components/ChecklistFlow";
import { suggestQuestions } from "@/app/lib/extraction/insurer-questions";
import type { RegisteredComparisonTable as Table } from "@/app/lib/extraction/types";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const questions = useMemo(() => (table ? suggestQuestions(table) : []), [table]);
  const [mode, setMode] = useState<"upload" | "checklist">("upload");

  async function handleUploaded(result: UploadResult) {
    setSessionId(result.sessionId);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Extraction failed");
      setTable(data as Table);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      {!table && mode === "upload" && (
        <>
          <UploadDropzone onUploaded={handleUploaded} />
          <p className="notice">
            Still waiting on your plan documents?{" "}
            <button className="btn--link" onClick={() => setMode("checklist")}>
              I don&apos;t have documents yet
            </button>
          </p>
        </>
      )}
      {!table && mode === "checklist" && (
        <ChecklistFlow onHaveDocuments={() => setMode("upload")} />
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
      {table && sessionId && (
        <>
          <div className="results">
            <ComparisonTable table={table} sessionId={sessionId} />
            <div className="results__tools">
              <ChatPanel sessionId={sessionId} documents={table.documents} />
            </div>
          </div>
          <InsurerQuestions questions={questions} />
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
