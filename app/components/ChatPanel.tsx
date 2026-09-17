"use client";

import { useState } from "react";
import type { ChatResponse } from "@/app/lib/rag/answer";
import { documentUrl } from "@/app/lib/document-url";

interface Turn {
  question: string;
  response: ChatResponse;
}

export default function ChatPanel({
  sessionId,
  documents,
  initialTurns,
}: {
  sessionId: string;
  documents: { documentId: string; filename: string }[];
  /** Test seam for rendering citations without driving the chat API. */
  initialTurns?: Turn[];
}) {
  const filename = (documentId: string) =>
    documents.find((d) => d.documentId === documentId)?.filename ?? documentId;
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>(initialTurns ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Chat failed");
      setTurns([...turns, { question, response: data as ChatResponse }]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel" aria-label="Chat about your plans">
      <h2>Ask about your plans</h2>
      <p className="text-muted">
        Answers only come from your documents, with page references.
      </p>
      {turns.length > 0 && (
        <div className="chat__turns">
          {turns.map((t, i) => (
            <div key={i}>
              <p className="chat__q">{t.question}</p>
              {t.response.kind === "answer" ? (
                <div className="chat__a">
                  <p>{t.response.answerText}</p>
                  <ul className="list">
                    {t.response.citations.map((c, j) => (
                      <li key={j}>
                        {c.documentId},{" "}
                        <a
                          href={documentUrl(sessionId, c.documentId, filename(c.documentId), c.page, c.evidenceId)}
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
          ))}
        </div>
      )}
      <div className="chat__form">
        <input
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
    </aside>
  );
}
