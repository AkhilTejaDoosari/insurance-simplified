"use client";

import { useMemo, useState } from "react";
import UploadDropzone, { type UploadResult } from "@/app/components/UploadDropzone";
import ComparisonTable, { type SelectedCell } from "@/app/components/ComparisonTable";
import EvidencePanel from "@/app/components/EvidencePanel";
import ChatPanel from "@/app/components/ChatPanel";
import InsurerQuestions from "@/app/components/InsurerQuestions";
import ChecklistFlow from "@/app/components/ChecklistFlow";
import { suggestQuestions } from "@/app/lib/extraction/insurer-questions";
import type { ComparisonTable as Table } from "@/app/lib/extraction/types";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
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
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1>Insurance Simplified</h1>
      {!table && mode === "upload" && (
        <>
          <UploadDropzone onUploaded={handleUploaded} />
          <button onClick={() => setMode("checklist")}>
            I don&apos;t have documents yet
          </button>
        </>
      )}
      {!table && mode === "checklist" && (
        <ChecklistFlow onHaveDocuments={() => setMode("upload")} />
      )}
      {busy && <p>Extracting comparison…</p>}
      {error && <p role="alert">{error}</p>}
      {table && sessionId && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
            <div>
              <ComparisonTable table={table} onSelectCell={setSelected} />
            </div>
            <div>
              <EvidencePanel cell={selected} />
              <ChatPanel sessionId={sessionId} />
            </div>
          </div>
          <InsurerQuestions questions={questions} />
        </>
      )}
      {sessionId && table && (
        <p>
          Session {sessionId} is temporary. Closing this page deletes your
          documents unless you download an export.{" "}
          <a href={`/api/export?sessionId=${sessionId}`} download>
            Download export (JSON)
          </a>
        </p>
      )}
    </main>
  );
}
