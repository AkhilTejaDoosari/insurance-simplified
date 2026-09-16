"use client";

import { useState } from "react";
import type { ChatResponse } from "@/app/lib/rag/answer";

interface Turn {
  question: string;
  response: ChatResponse;
}

export default function ChatPanel({ sessionId }: { sessionId: string }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
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
    <aside aria-label="Chat about your plans">
      <h2>Ask about your plans</h2>
      {turns.map((t, i) => (
        <div key={i}>
          <p><strong>You:</strong> {t.question}</p>
          {t.response.kind === "answer" ? (
            <div>
              <p>{t.response.answerText}</p>
              <ul>
                {t.response.citations.map((c, j) => (
                  <li key={j}>
                    {c.documentId}, page {c.page}: “{c.quote}”
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p><em>{t.response.refusalText}</em></p>
          )}
        </div>
      ))}
      <input
        aria-label="Your question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void ask(); }}
        placeholder="e.g. What is the emergency copay?"
      />
      <button onClick={() => void ask()} disabled={busy}>
        {busy ? "…" : "Ask"}
      </button>
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
