"use client";

import { useState } from "react";

export interface UploadResult {
  sessionId: string;
  documents: { documentId: string; filename: string; pageCount: number }[];
}

const CONTEXT_FIELDS = [
  { name: "age", label: "Age" },
  { name: "countryOrResidency", label: "Country / residency" },
  { name: "visaOrStatus", label: "Visa / status (if relevant)" },
  { name: "location", label: "Location" },
  { name: "coverageDates", label: "Coverage dates" },
] as const;

export default function UploadDropzone({
  onUploaded,
}: {
  onUploaded: (result: UploadResult, context: Record<string, string>) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [context, setContext] = useState<Record<string, string>>({});
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
      for (const { name } of CONTEXT_FIELDS) {
        if (context[name]?.trim()) form.set(name, context[name].trim());
      }
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
      <fieldset>
        <legend>Your context (used only when documents make it relevant)</legend>
        {CONTEXT_FIELDS.map(({ name, label }) => (
          <label key={name} style={{ display: "block", marginTop: 8 }}>
            {label}{" "}
            <input
              value={context[name] ?? ""}
              onChange={(e) => setContext({ ...context, [name]: e.target.value })}
            />
          </label>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button onClick={submit} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "Processing…" : "Compare documents"}
      </button>
    </section>
  );
}
