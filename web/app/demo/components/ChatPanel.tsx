"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CircleAlert, SendHorizontal, X } from "lucide-react";
import s from "../demo.module.css";
import type { ChatEntry } from "../lib/demo-chat";
import { SourceButton, cx, useDemo } from "./shared";

export interface ChatPanelProps {
  selected: string[];
  log: ChatEntry[];
  /** Suggested questions with their index in the router's list. */
  suggestions: { text: string; i: number }[];
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onAsk: (i: number) => void;
  onTyped: (q: string) => void;
}

export function ChatPanel(p: ChatPanelProps) {
  const { M } = useDemo();
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const l = logRef.current;
    if (l) l.scrollTop = l.scrollHeight;
  }, [p.log.length]);

  return (
    <>
      <div className={s.chHead}>
        <div>
          <h2 style={{ fontSize: 19 }}>Ask about your plans</h2>
          <div className={s.muted} style={{ fontSize: 12 }}>
            Answering only from: {p.selected.map(M.nm).join(", ") || "—"}
          </div>
        </div>
        <button type="button" className={s.quiet} onClick={p.onClose} ref={p.closeRef} aria-label="Close chat">
          Close <X size={14} aria-hidden />
        </button>
      </div>
      <div className={s.chLog} ref={logRef} aria-live="polite">
        {p.log.length ? (
          p.log.map((m, i) => (
            <div key={i}>
              <div className={cx(s.msg, s.me)}>{m.question}</div>
              <div className={cx(s.msg, s.bot)}>
                <span className={s.tag}>{m.tag}</span>
                <div>
                  {m.lines.map((line, j) => (
                    <div key={j}>
                      {line.map((seg, n) =>
                        "src" in seg ? (
                          <SourceButton key={n} id={seg.src[0]} k={seg.src[1]} label={seg.label} />
                        ) : seg.strong ? (
                          <b key={n}>{seg.text}</b>
                        ) : (
                          <span key={n}>{seg.text}</span>
                        ),
                      )}
                    </div>
                  ))}
                </div>
                {m.see && <SourceButton id={m.see[0]} k={m.see[1]} label="See the page" />}
              </div>
            </div>
          ))
        ) : (
          <div className={cx(s.muted, s.small)}>
            Answers come from the plans you selected, with page links. Try a question below.
          </div>
        )}
      </div>
      <div className={s.chIn}>
        <div className={s.sugg}>
          {p.suggestions.map(({ text, i }) => (
            <button type="button" key={text} onClick={() => p.onAsk(i)}>
              {text}
            </button>
          ))}
        </div>
        <form
          className={s.chForm}
          onSubmit={(e) => {
            e.preventDefault();
            const v = q.trim();
            if (!v) {
              setErr("Type a question first.");
              return;
            }
            p.onTyped(v);
            setQ("");
          }}
        >
          <input
            value={q}
            placeholder="Is dental covered on Globe Gold?"
            aria-label="Your question"
            aria-invalid={err ? true : undefined}
            aria-describedby="demo-chat-err"
            onChange={(e) => {
              setQ(e.target.value);
              setErr("");
            }}
          />
          <button className={cx(s.btn, s.sm)} type="submit">
            <SendHorizontal size={16} aria-hidden />
            Ask
          </button>
        </form>
        <div id="demo-chat-err" className={s.errorText} role="alert">
          {err && (
            <>
              <CircleAlert size={14} aria-hidden />
              {err}
            </>
          )}
        </div>
      </div>
    </>
  );
}
