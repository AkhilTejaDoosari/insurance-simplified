"use client";

import { useRef, useState } from "react";
import ChecklistFlow from "@/app/components/ChecklistFlow";
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
  extractError,
  showRetry,
  onRetry,
  onFilesChanged,
  mode = "documents",
  onModeChange,
}: {
  onUploaded: (result: UploadResult, context: Record<string, string>) => void;
  context?: Record<string, string>;
  onContextChange?: (next: Record<string, string>) => void;
  externalBusy?: boolean;
  externalBusyLabel?: string;
  extractError?: string | null;
  showRetry?: boolean;
  onRetry?: () => void;
  onFilesChanged?: () => void;
  mode?: "documents" | "guided";
  onModeChange?: (mode: "documents" | "guided") => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [internalContext, setInternalContext] = useState<
    Record<string, string>
  >({
    countryOrResidency: DEFAULT_COUNTRY,
  });
  const context = controlledContext ?? internalContext;
  const setContext = onContextChange ?? setInternalContext;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const fileGeneration = useRef(0);
  const effectiveBusy = busy || externalBusy === true;
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyLabel = busy
    ? "Uploading and reading your documents…"
    : (externalBusyLabel ??
      "Extracting insurance terms and preparing your results…");

  async function submit() {
    if (submitting.current) return;
    const generation = fileGeneration.current;
    setError(null);
    if (files.length < 1 || files.length > 5) {
      setError(`Upload 1–5 PDF documents (selected ${files.length}).`);
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
      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const data = await res.json();
      if (generation !== fileGeneration.current) return;
      if (!res.ok) {
        const detail = data.failures
          ? `: ${(data.failures as { filename: string; reason: string }[]).map((f) => `${f.filename} — ${f.reason}`).join("; ")}`
          : "";
        const message = data.error?.message ?? data.error ?? "Upload failed";
        throw new Error(`${message}${detail}`);
      }
      onUploaded(data as UploadResult, context);
    } catch (err) {
      if (generation === fileGeneration.current)
        setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function addFiles(selected: File[]) {
    if (files.length + selected.length > 5) {
      setError(
        `You can upload up to 5 PDFs. Remove a file before adding another (already ${files.length}).`,
      );
      return;
    }
    const invalid = selected.filter(
      (file) =>
        !/\.pdf$/i.test(file.name) ||
        (file.type && file.type !== "application/pdf"),
    );
    const valid = selected.filter((file) => !invalid.includes(file));
    setError(
      invalid.length
        ? `Only PDF files are supported: ${invalid.map((file) => file.name).join(", ")}`
        : null,
    );
    if (!valid.length) return;
    fileGeneration.current++;
    setFiles((prior) => [...prior, ...valid]);
    onFilesChanged?.();
  }

  return (
    <section
      className="intake-section"
      id="start"
      aria-label="Upload insurance documents"
    >
      <div className="linehead">
        <div>
          <span className="eyebrow">Get started</span>
          <h2>Tell us what you&apos;re looking at.</h2>
        </div>
        <span className="pill">One simple starting point</span>
      </div>
      <div className="formgrid">
        <div className="panel intake-context">
          <h3>Your situation</h3>
          <p className="sub">
            Only the details that may affect which coverage applies.
          </p>
          <ContextInputs
            context={context}
            onChange={(next) => {
              if (submitting.current) {
                fileGeneration.current++;
                setError(
                  "Your details changed during upload. Submit again to refresh your results.",
                );
              }
              setContext(next);
            }}
          />
          <div className="guidance">
            <span aria-hidden="true">✳</span>
            <div>
              <b>Why do we ask?</b>Age, travel location, status, and coverage
              dates can change what a policy actually means for you.
            </div>
          </div>
        </div>
        <div className="panel intake-documents">
          <h3>Where should we begin?</h3>
          <p className="sub">You can always change this later.</p>
          <div
            className="modeSwitch"
            role="group"
            aria-label="Choose your starting path"
          >
            <button
              type="button"
              aria-pressed={mode === "documents"}
              onClick={() => onModeChange?.("documents")}
            >
              I have documents
            </button>
            <button
              type="button"
              aria-pressed={mode === "guided"}
              onClick={() => onModeChange?.("guided")}
            >
              I don&apos;t have documents
            </button>
          </div>
          <div hidden={mode !== "documents"}>
            <button
              type="button"
              className={`upload${dragging ? " upload--dragging" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles([...e.dataTransfer.files]);
              }}
            >
              <svg
                aria-hidden="true"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
              </svg>
              <strong>Choose PDF files</strong>
              <span>or drag and drop them here</span>
              <small>1–5 documents · PDF only</small>
            </button>
            <input
              ref={inputRef}
              aria-label="Choose insurance PDF files"
              className="sr-only"
              tabIndex={-1}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(e) => {
                addFiles([...(e.target.files ?? [])]);
                e.currentTarget.value = "";
              }}
            />
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((f, index) => (
                  <li key={`${f.name}-${index}`}>
                    <span>{f.name}</span>
                    <button
                      type="button"
                      className="file-list__remove"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => {
                        fileGeneration.current++;
                        setFiles((prior) =>
                          prior.filter((_, i) => i !== index),
                        );
                        setError(null);
                        onFilesChanged?.();
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="sub">
              Compare multiple brochures or understand just one. Up to three
              plans shown at a time.
            </p>
            {error && (
              <p role="alert" className="alert" style={{ marginTop: 16 }}>
                {error}
              </p>
            )}
            <div className="actions actions--compare">
              <button
                className="btn"
                onClick={submit}
                disabled={effectiveBusy}
                aria-busy={effectiveBusy}
              >
                {effectiveBusy
                  ? "Processing…"
                  : files.length === 1
                    ? "Understand my document"
                    : "Compare my plans"}
              </button>
              {effectiveBusy && (
                <p className="notice notice--inline" role="status">
                  <span className="spinner" aria-hidden="true" />
                  {busyLabel}
                </p>
              )}
            </div>
            {extractError && !effectiveBusy && (
              <div className="actions actions--retry">
                <p role="alert" className="alert">
                  {extractError}
                </p>
                {showRetry && onRetry && (
                  <button
                    type="button"
                    className="btn"
                    onClick={onRetry}
                    disabled={effectiveBusy}
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
          {mode === "guided" && (
            <ChecklistFlow
              embedded
              context={context}
              onContextChange={setContext}
              onHaveDocuments={() => onModeChange?.("documents")}
            />
          )}
        </div>
      </div>
    </section>
  );
}
