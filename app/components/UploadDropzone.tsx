"use client";

import { useRef, useState } from "react";
import ContextInputs, {
  combineCoverageDates,
  combineLocation,
  resolveVisaOrStatus,
  DEFAULT_COUNTRY,
} from "@/app/components/ContextInputs";

export interface UploadResult {
  sessionId: string;
  documents: { documentId: string; filename: string; pageCount: number }[];
}

const TEXT_FIELDS = ["age", "countryOrResidency"] as const;

export default function UploadDropzone({
  onUploaded,
  context: controlledContext,
  onContextChange,
  externalBusy,
  externalBusyLabel,
}: {
  onUploaded: (result: UploadResult, context: Record<string, string>) => void;
  context?: Record<string, string>;
  onContextChange?: (next: Record<string, string>) => void;
  externalBusy?: boolean;
  externalBusyLabel?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [internalContext, setInternalContext] = useState<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  const context = controlledContext ?? internalContext;
  const setContext = onContextChange ?? setInternalContext;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const effectiveBusy = busy || externalBusy === true;
  const busyLabel = busy ? "Reading your documents…" : (externalBusyLabel ?? "Building your comparison…");

  async function submit() {
    if (submitting.current) return;
    setError(null);
    if (files.length < 2 || files.length > 4) {
      setError(`Upload 2–4 PDF documents (selected ${files.length}).`);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("documents", f);
      for (const name of TEXT_FIELDS) {
        if (context[name]?.trim()) form.set(name, context[name].trim());
      }
      const visaOrStatus = resolveVisaOrStatus(context);
      if (visaOrStatus) form.set("visaOrStatus", visaOrStatus);
      const location = combineLocation(context);
      if (location) form.set("location", location);
      const coverageDates = combineCoverageDates(context);
      if (coverageDates) form.set("coverageDates", coverageDates);
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.failures
          ? `: ${(data.failures as { filename: string; reason: string }[]).map((f) => `${f.filename} — ${f.reason}`).join("; ")}`
          : "";
        const message = data.error?.message ?? data.error ?? "Upload failed";
        throw new Error(`${message}${detail}`);
      }
      onUploaded(data as UploadResult, context);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Upload insurance documents">
      <h2>Upload 2–4 insurance PDFs</h2>
      <p className="text-muted">
        Plan summaries, benefit schedules or brochures. Nothing is stored after
        you close the page.
      </p>
      <input
        type="file"
        accept="application/pdf,.pdf"
        multiple
        style={{ marginTop: 12 }}
        onChange={(e) => setFiles([...(e.target.files ?? [])])}
      />
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.name}>{f.name}</li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 20 }}>
        <ContextInputs context={context} onChange={setContext} />
      </div>
      {error && (
        <p role="alert" className="alert" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
      <div className="actions actions--compare">
        <button className="btn" onClick={submit} disabled={effectiveBusy} aria-busy={effectiveBusy}>
          {effectiveBusy ? "Processing…" : "Compare my plans"}
        </button>
        {effectiveBusy && (
          <p className="notice notice--inline" role="status">
            <span className="spinner" aria-hidden="true" />
            {busyLabel}
          </p>
        )}
      </div>
    </section>
  );
}
