"use client";

import { useEffect, useRef, useState } from "react";
import type { RegisteredChatResponse } from "@/app/lib/rag/answer";
import { documentUrl } from "@/app/lib/document-url";

interface Turn {
  question: string;
  response: RegisteredChatResponse;
  /** Effective selection key (opaque) the turn was answered under, when the
   *  results page has an active selection. Turns answered under a different
   *  selection stay visible but are labelled as historical scope. */
  selectionKey?: string;
  /** Scope label captured at ask time, for the historical label. */
  scopeLabel?: string;
}

/** Opaque selection reference sent with every question (chat task 17/18):
 *  validated server-side against the stored result before retrieval. */
export interface ChatSelectionPayload {
  resultFingerprint: string;
  planIds: string[];
  tiers: Record<string, string | null>;
  legacyTiersByDocument: Record<string, string>;
  selectionKey: string;
  viewMode?: "understand" | "compare";
  documentId?: string;
}

export default function ChatPanel({
  sessionId,
  documents,
  selection,
  scopeLabel,
  initialTurns,
  open = true,
  onClose,
  draft,
}: {
  sessionId: string;
  documents: { documentId: string; filename: string }[];
  /** Active plan/tier selection for scope-consistent answers. */
  selection?: ChatSelectionPayload;
  /** Human label of the current effective scope (plan names × tiers). */
  scopeLabel?: string;
  /** Test seam for rendering citations without driving the chat API. */
  initialTurns?: Turn[];
  open?: boolean;
  onClose?: () => void;
  draft?: { text: string; key: number };
}) {
  const filename = (documentId: string) =>
    documents.find((d) => d.documentId === documentId)?.filename ?? documentId;
  const effectiveKey = selection?.selectionKey;
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>(initialTurns ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each question is tied to the selection it was asked under. Sequence +
  // AbortController together: no late response from a superseded scope can
  // ever land in the visible turns (task 18 race discipline).
  const requestSequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (draft) setQuestion(draft.text);
  }, [draft]);
  useEffect(
    () => () => {
      requestSequence.current++;
      controllerRef.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!open || !onClose) return;
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const background = mobile
      ? [
          ...document.querySelectorAll<HTMLElement>(
            "[data-chat-background], .site-header",
          ),
        ]
      : [];
    const priorInert = background.map((el) => el.inert);
    background.forEach((el) => {
      el.inert = true;
    });
    const overflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !mobile) return;
      const controls = [
        ...(panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        ) ?? []),
      ];
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      background.forEach((el, index) => {
        el.inert = priorInert[index];
      });
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, mobile, onClose]);

  // Selection changed: in-flight answers are no longer valid for this view.
  // Abort them, drop them, clear any selection-scoped error, and free the
  // busy state the aborted request could otherwise leave dangling.
  useEffect(() => {
    requestSequence.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setError(null);
  }, [effectiveKey]);

  async function ask() {
    if (!question.trim() || busy) return;
    const seq = ++requestSequence.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(null);
    const askedSelection = selection;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          sessionId,
          question,
          ...(askedSelection ? { selection: askedSelection } : {}),
        }),
      });
      if (seq !== requestSequence.current) return; // scope changed mid-flight: discard
      const data = await res.json();
      if (!res.ok) {
        const message = data.error?.message ?? data.error ?? "Chat failed";
        throw new Error(message);
      }
      setTurns((prior) => [
        {
          question,
          response: data as RegisteredChatResponse,
          ...turnStamp(askedSelection, scopeLabel),
        },
        ...prior,
      ]);
      setQuestion("");
    } catch (err) {
      if (seq !== requestSequence.current || controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      if (seq === requestSequence.current) {
        setBusy(false);
        controllerRef.current = null;
      }
    }
  }

  return (
    <div
      ref={panelRef}
      className="chat-panel"
      role={mobile && open ? "dialog" : "region"}
      aria-modal={mobile && open ? true : undefined}
      aria-label="Document assistant"
    >
      <div className="dockTop">
        <div>
          <h2>
            {documents.length === 1
              ? "Ask about your document"
              : "Ask about your plans"}
          </h2>
          <small>Grounded in your selected documents</small>
        </div>
        {onClose && (
          <button
            type="button"
            className="dockClose"
            aria-label="Close chat"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      <div className="dockMessages" aria-live="polite">
        <p className="dockBubble">
          Answers only come from your documents, with page references.
        </p>
        {turns.length === 0 && (
          <div className="dockSuggestions">
            {[
              "What should I verify before enrolling?",
              "Explain the deductible",
              "What are the important exclusions?",
            ].map((text) => (
              <button
                type="button"
                key={text}
                onClick={() => {
                  setQuestion(text);
                  inputRef.current?.focus();
                }}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {turns.length > 0 && (
          <div className="chat__turns">
            {turns.map((t, i) => {
              const historical =
                t.scopeLabel !== undefined &&
                t.selectionKey !== undefined &&
                t.selectionKey !== effectiveKey;
              return (
                <div key={i}>
                  <p className="chat__q">{t.question}</p>
                  {historical && (
                    <p className="text-muted chat__scope-note">
                      Answered earlier for: {t.scopeLabel}
                    </p>
                  )}
                  {t.response.kind === "answer" ? (
                    <div className="chat__a">
                      {(t.response.grounding === "related" ||
                        t.response.grounding === "needs-external") && (
                        <p className="text-muted">
                          {t.response.grounding === "related"
                            ? "Related passages — indirectly answered."
                            : "Needs an outside source — verify before enrolling."}
                        </p>
                      )}
                      <p>{t.response.answerText}</p>
                      <ul className="list">
                        {t.response.citations.map((c, j) => (
                          <li key={j}>
                            {c.documentId},{" "}
                            <a
                              href={documentUrl(
                                sessionId,
                                c.documentId,
                                filename(c.documentId),
                                c.page,
                                c.evidenceId,
                              )}
                              target="_blank"
                              rel="noopener"
                            >
                              page {c.page}
                            </a>
                            : “{c.quote}”
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="chat__refusal">{t.response.refusalText}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="chat__form">
        <input
          ref={inputRef}
          className="input"
          aria-label="Your question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
          placeholder="e.g. What is the emergency copay?"
        />
        <button className="btn" onClick={() => void ask()} disabled={busy}>
          {busy ? "…" : "Ask"}
        </button>
      </div>
      {error && (
        <p role="alert" className="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}

function turnStamp(
  selection: ChatSelectionPayload | undefined,
  label: string | undefined,
): { selectionKey?: string; scopeLabel?: string } {
  if (!selection) return {};
  // With no explicit label (e.g. single shared scope), the turn still carries
  // the key so historical turns under a later selection are labelled.
  return {
    selectionKey: selection.selectionKey,
    scopeLabel: label ?? "All plans",
  };
}
