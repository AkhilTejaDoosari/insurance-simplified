"use client";

import { useState } from "react";
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
}: {
  onUploaded: (result: UploadResult, context: Record<string, string>) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [context, setContext] = useState<Record<string, string>>({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (files.length < 2 || files.length > 4) {
      setError(`Upload 2–4 PDF documents (selected ${files.length}).`);
      return;
    }
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
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.failures
          ? `: ${(data.failures as { filename: string; reason: string }[]).map((f) => `${f.filename} — ${f.reason}`).join("; ")}`
          : "";
        throw new Error(`${data.error ?? "Upload failed"}${detail}`);
      }
      onUploaded(data as UploadResult, context);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Upload insurance documents">
      <h2>Upload 2–4 insurance PDFs</h2>
      <input
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onChange={(e) => setFiles([...(e.target.files ?? [])])}
      />
      <ul>
        {files.map((f) => (
          <li key={f.name}>{f.name}</li>
        ))}
      </ul>
      <ContextInputs context={context} onChange={setContext} />
      {error && <p role="alert">{error}</p>}
      <button onClick={submit} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "Processing…" : "Compare documents"}
      </button>
    </section>
  );
}
