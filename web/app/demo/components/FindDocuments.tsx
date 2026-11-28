"use client";

import { useState } from "react";
import { CircleAlert, Copy, Sparkles, TriangleAlert } from "lucide-react";
import s from "../demo.module.css";
import { OPT, REQUIREMENTS, WHERE, WHO, buildPrompt, type Country } from "../lib/demo-prompt";
import { cx } from "./shared";

export function FindDocuments({ country, onCountry }: { country: Country; onCountry: (c: Country) => void }) {
  const o = OPT[country];
  const [city, setCity] = useState("");
  const [code, setCode] = useState("");
  const [age, setAge] = useState("");
  const [who, setWho] = useState(WHO(country)[0]);
  const [how, setHow] = useState(o.how[0]);
  const [requirement, setRequirement] = useState(REQUIREMENTS[0]);
  const [matters, setMatters] = useState("");
  const [err, setErr] = useState("");
  const [out, setOut] = useState("");
  const [copied, setCopied] = useState("");

  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setErr("");
  };

  return (
    <div className={cx(s.page, s.findPage)}>
      <span className={s.eyebrow}>No documents yet?</span>
      <h1>Find your plan documents</h1>
      <div className={s.grid2}>
        <div className={s.card}>
          <h2 className={s.cardTitle}>Where your documents usually are</h2>
          <dl className={s.where}>
            {WHERE.map(([dt, dd]) => (
              <div key={dt}>
                <dt>{dt}</dt>
                <dd>{dd}</dd>
              </div>
            ))}
          </dl>
          <div className={s.notice}>
            <TriangleAlert size={16} aria-hidden className={s.icon} style={{ marginTop: 3 }} />
            <span>If an insurer won&apos;t give you its plan terms in writing, treat that as a warning sign.</span>
          </div>
        </div>

        <div className={s.card}>
          <h2 className={s.cardTitle}>Ask your own AI to find them</h2>
          <p className={cx(s.muted, s.small)} style={{ marginTop: "var(--s1)" }}>
            Creates a prompt for ChatGPT, Claude, Gemini or another AI that can search the web. We never ask for ID numbers
            or immigration status.
          </p>
          <label className={s.field}>
            Country
            <select
              value={country}
              onChange={(e) => {
                const c = e.target.value as Country;
                onCountry(c);
                setHow(OPT[c].how[0]);
                setWho(WHO(c)[0]);
                setErr("");
              }}
            >
              <option value="US">United States</option>
              <option value="IN">India</option>
            </select>
          </label>
          <label className={s.field}>
            State and city
            <input value={city} onChange={edit(setCity)} placeholder={o.ph[0]} aria-invalid={err && !city.trim() ? true : undefined} />
          </label>
          <label className={s.field}>
            {o.loc}
            <input value={code} onChange={edit(setCode)} placeholder={o.ph[1]} inputMode="numeric" />
          </label>
          <label className={s.field}>
            Age
            <input
              type="number"
              min={0}
              max={120}
              value={age}
              onChange={edit(setAge)}
              placeholder="27"
              aria-invalid={err && (!age.trim() || +age < 0 || +age > 120) ? true : undefined}
            />
          </label>
          <label className={s.field}>
            Who should be covered
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              {WHO(country).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            How you&apos;ll get coverage
            <select value={how} onChange={(e) => setHow(e.target.value)}>
              {o.how.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            Must it meet a requirement?
            <select value={requirement} onChange={(e) => setRequirement(e.target.value)}>
              {REQUIREMENTS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            What matters most
            <input value={matters} onChange={edit(setMatters)} placeholder={o.ex} />
          </label>
          <div className={s.errorText} role="alert">
            {err && (
              <>
                <CircleAlert size={14} aria-hidden />
                {err}
              </>
            )}
          </div>
          <button
            type="button"
            className={cx(s.btn, s.sm)}
            onClick={() => {
              const r = buildPrompt({ country, city, code, age, who, how, requirement, matters });
              if (!r.ok) {
                setErr(r.error);
                return;
              }
              setOut(r.prompt);
              setCopied("");
            }}
          >
            <Sparkles size={16} aria-hidden />
            Create my prompt
          </button>
          <textarea
            className={s.prompt}
            rows={12}
            readOnly
            value={out}
            placeholder="Your prompt appears here"
            aria-label="Your prompt"
            id="demo-prompt-out"
          />
          <div className={s.copyRow}>
            <button
              type="button"
              className={s.quiet}
              onClick={() => {
                if (!out) {
                  setCopied("Create the prompt first.");
                  return;
                }
                const select = () => {
                  (document.getElementById("demo-prompt-out") as HTMLTextAreaElement | null)?.select();
                  setCopied("Selected: press Ctrl/Cmd+C");
                };
                if (!navigator.clipboard) return select();
                navigator.clipboard.writeText(out).then(() => setCopied("Copied"), select);
              }}
            >
              <Copy size={14} aria-hidden />
              Copy prompt
            </button>
            <span className={cx(s.muted, s.small)} aria-live="polite">
              {copied}
            </span>
          </div>
          <div className={s.notice}>
            <TriangleAlert size={16} aria-hidden className={s.icon} style={{ marginTop: 3 }} />
            <span>
              An AI search finds some plans, not every plan, and can be wrong or out of date. Check that each link opens a
              real document from the insurer. Insurance Simplified checks what your documents say; it can&apos;t tell you
              whether better plans exist.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
