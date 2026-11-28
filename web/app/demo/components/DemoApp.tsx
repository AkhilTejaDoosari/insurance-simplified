"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Menu, MessageCircle } from "lucide-react";
import s from "../demo.module.css";
import { bodyFont, displayFont } from "../fonts";
import { bundleFromEngine, loadDemoBundle, type DemoBundle, type DemoTier } from "../lib/demo-adapter";
import type { V2Document } from "@/app/lib/engine/client";
import { demoChat, type ChatEntry } from "../lib/demo-chat";
import { CUTN, TIERS, demoModel, initialNeeds, type NeedState } from "../lib/demo-logic";
import type { Country } from "../lib/demo-prompt";
import { ChatPanel } from "./ChatPanel";
import { FindDocuments } from "./FindDocuments";
import { Landing } from "./Landing";
import { DEMO_PDF_NOTE, PdfViewer, demoPdfUrl, type ViewerTarget } from "./PdfViewer";
import { ChecksNotice, LiveReading, LiveUpload, checkFiles, type JobView, type ReadPhase, type Rejected } from "./LiveScreens";
import { ResultsMain } from "./ResultsMain";
import { Sidebar } from "./Sidebar";
import { ReadingScreen, UploadScreen } from "./StepScreens";
import { DemoContext, cx, type DemoActions } from "./shared";

type Screen = "home" | "upload" | "reading" | "results" | "find";
type Panel = "sb" | "ch";

const SHEET_BREAKPOINT = 900; // sidebar and chat become full-screen sheets below this width
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Words shown when the upload API refuses files; never document content. */
function uploadMessage(data: unknown): string {
  const d = (data ?? {}) as { error?: { message?: string } | string; failures?: { filename: string; reason: string }[] };
  const base = (typeof d.error === "string" ? d.error : d.error?.message) ?? "The upload failed. Please try again.";
  const files = d.failures?.map((f) => `${f.filename}: ${f.reason}`).join("; ");
  return files ? `${base} (${files})` : base;
}

/**
 * The V2 screens (docs/v2/demo, D-038). ``source="demo"`` (/demo): the demo's own invented
 * data. ``source="live"`` (/): the real engine results of the user's uploaded session,
 * through the same adapter shape ({ CAT, DOCS, FACTS, PLANS }).
 */
export default function DemoApp({ source = "demo" }: { source?: "demo" | "live" }) {
  const live = source === "live";
  const demoM = useMemo(() => demoModel(loadDemoBundle()), []);
  const [bundle, setBundle] = useState<DemoBundle | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const M = useMemo(() => (live && bundle ? demoModel(bundle) : demoM), [live, bundle, demoM]);
  const chat = useMemo(() => demoChat(M), [M]);
  const M0 = demoM;

  const [screen, setScreen] = useState<Screen>("home");
  const [loaded, setLoaded] = useState<string[]>(() => M0.DOCS.filter((d) => d.initial).map((d) => d.id));
  const [sel, setSel] = useState<ReadonlySet<string>>(() => new Set(["g2", "g3", "c1", "s1"]));
  const [order, setOrder] = useState<string[]>(() => Object.keys(M0.PLANS));
  const [sb, setSb] = useState(true);
  const [ch, setCh] = useState(true);
  const [compact, setCompact] = useState(false);
  const [cut, setCut] = useState<DemoTier>(2);
  const [log, setLog] = useState<ChatEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [ctry, setCtry] = useState<Country>("US");
  const [needs, setNeeds] = useState<NeedState[]>(initialNeeds);
  const [viewer, setViewerState] = useState<{ t: ViewerTarget; demo: boolean } | null>(null);
  // live: the files picked, the session read from them, and the reading state
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<ReadPhase>("uploading");
  const [readError, setReadError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const readSeq = useRef(0);
  const [mainW, setMainW] = useState(1000);
  const [sheets, setSheets] = useState(false);
  const [flashTick, setFlashTick] = useState(0);

  const hambRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const sbCloseRef = useRef<HTMLButtonElement>(null);
  const chCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const chatRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const viewerOpener = useRef<HTMLElement | null>(null);
  const panelOpener = useRef<Record<Panel, HTMLElement | null>>({ sb: null, ch: null });
  const pendingFocus = useRef<HTMLElement | null | (() => HTMLElement | null)>(null);
  const lastOpened = useRef<Panel | null>(null);

  // Like the demo: on narrow screens both panels start closed.
  useEffect(() => {
    if (window.innerWidth < SHEET_BREAKPOINT) {
      setSb(false);
      setCh(false);
    }
    const mq = window.matchMedia(`(max-width: ${SHEET_BREAKPOINT}px)`);
    const on = () => setSheets(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const go = useCallback((p: Screen) => {
    setScreen(p);
    window.scrollTo(0, 0);
  }, []);

  /* ---------- live: upload the files, then read them through the engine ---------- */
  const show = useCallback((docs: V2Document[]) => {
    setIncomplete(docs.some((d) => d.checksIncomplete === true));
    const b = bundleFromEngine(docs);
    setBundle(b);
    setLoaded(b.DOCS.map((d) => d.id));
    setSel(new Set(Object.keys(b.PLANS)));
    setOrder(Object.keys(b.PLANS));
    setLog([]);
  }, []);
  /* ---------- background reads (WP5): follow the session's jobs until they all end ---------- */
  const follow = useCallback(
    async (sid: string, seq: number) => {
      remember(sid); // a reload mid-read picks the reading up again
      for (;;) {
        const r = await fetch(`/api/jobs/${encodeURIComponent(sid)}`, { credentials: "include", cache: "no-store" });
        const d = (await r.json().catch(() => null)) as {
          done?: boolean;
          jobs?: JobView[];
          engine?: { documents?: V2Document[] };
          error?: { message?: string };
        } | null;
        if (seq !== readSeq.current) return;
        if (!r.ok) throw new Error(d?.error?.message ?? "Reading failed. Please try again.");
        setJobs(d?.jobs ?? []);
        if (d?.done) {
          const docs = d.engine?.documents ?? [];
          if (!docs.length)
            throw new Error(
              (d.jobs ?? []).every((j) => j.status === "cancelled")
                ? "Reading was cancelled. Choose files to start again."
                : "None of your documents could be read. Please try again.",
            );
          show(docs);
          setPhase("done");
          return;
        }
        await new Promise((res) => setTimeout(res, 2000));
        if (seq !== readSeq.current) return;
      }
    },
    [show],
  );
  const cancelRead = useCallback(async () => {
    if (!sessionId) return;
    const r = await fetch(`/api/jobs/${encodeURIComponent(sessionId)}/cancel`, { method: "POST", credentials: "include" });
    const d = (await r.json().catch(() => null)) as { jobs?: JobView[] } | null;
    if (d?.jobs) setJobs(d.jobs);
  }, [sessionId]);

  const read = useCallback(async () => {
    const seq = ++readSeq.current;
    setJobs([]);
    setBundle(null);
    setReadError("");
    setPhase("uploading");
    go("reading");
    try {
      const form = new FormData();
      for (const f of files) form.append("documents", f);
      const up = await fetch("/api/upload", { method: "POST", body: form, credentials: "include" });
      const ud = (await up.json().catch(() => null)) as { sessionId?: string } | null;
      if (seq !== readSeq.current) return;
      if (!up.ok || !ud?.sessionId) throw new Error(uploadMessage(ud));
      setSessionId(ud.sessionId);
      setPhase("reading");
      const ex = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: ud.sessionId, cloudConsent: consent }),
      });
      const ed = (await ex.json().catch(() => null)) as {
        engine?: { documents?: V2Document[] };
        error?: { message?: string };
      } | null;
      if (seq !== readSeq.current) return;
      if (!ex.ok) throw new Error(ed?.error?.message ?? "Reading failed. Please try again.");
      if (ex.status === 202) {
        // read in the background: one job per document
        await follow(ud.sessionId, seq);
        return;
      }
      const docs = ed?.engine?.documents;
      if (!docs?.length)
        throw new Error("The document reader isn't connected right now, so nothing could be read. Please try again later.");
      show(docs);
      setPhase("done");
      remember(ud.sessionId);
    } catch (e) {
      if (seq !== readSeq.current) return;
      setReadError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setPhase("error");
    }
  }, [files, consent, go, show, follow]);

  // A reload shows the saved results again: the session id is kept in this tab only
  // (sessionStorage; it is not authorization - the HttpOnly capability cookie is), and the
  // results come back from the server, saved with the session by /api/extract.
  useEffect(() => {
    if (!live) return;
    const id = recall();
    if (!id) return;
    let gone = false;
    fetch(`/api/results/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as { engine?: { documents?: V2Document[] } } | null;
        if (gone) return;
        const docs = r.ok ? d?.engine?.documents : undefined;
        if (!docs?.length) {
          // maybe still being read in the background: pick the reading up again
          const j = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
          const jd = (await j.json().catch(() => null)) as { jobs?: JobView[] } | null;
          if (gone) return;
          if (j.ok && jd?.jobs?.length) {
            const seq = ++readSeq.current;
            setSessionId(id);
            setJobs(jd.jobs);
            setPhase("reading");
            setScreen("reading");
            follow(id, seq).catch((e) => {
              if (seq !== readSeq.current) return;
              setReadError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
              setPhase("error");
            });
            return;
          }
          forget();
          return;
        }
        setSessionId(id);
        show(docs);
        setPhase("done");
        setScreen("results");
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [live, show, follow]);

  /* ---------- viewer ---------- */
  const viewerActions = useCallback(
    (model: typeof M, demo: boolean, pdfUrl: DemoActions["pdfUrl"], pdfNote: string): DemoActions => ({
      M: model,
      openSource: (planId, key, opener) => {
        viewerOpener.current = opener;
        setViewerState({ t: { kind: "src", planId, key }, demo });
      },
      openPdf: (docId, page, opener) => {
        viewerOpener.current = opener;
        setViewerState({ t: { kind: "pdf", docId, page }, demo });
      },
      pdfUrl,
      pdfNote,
    }),
    [],
  );
  // The landing's example sheet is always the demo's own (labelled "Demo document").
  const demoActions = useMemo(
    () => viewerActions(demoM, true, demoPdfUrl, DEMO_PDF_NOTE),
    [viewerActions, demoM],
  );
  const actions: DemoActions = useMemo(() => {
    if (!live) return demoActions;
    const url = (docId: string, page: number) =>
      sessionId
        ? `/api/document/${encodeURIComponent(sessionId)}/${encodeURIComponent(docId)}/${encodeURIComponent(
            M.docById(docId).file,
          )}#page=${page}`
        : "about:blank";
    return viewerActions(M, false, url, "Your uploaded document.");
  }, [live, demoActions, viewerActions, M, sessionId]);
  const closeViewer = useCallback(() => {
    setViewerState(null);
    pendingFocus.current = viewerOpener.current;
  }, []);

  /* ---------- sidebar + chat ---------- */
  const openPanel = (p: Panel, opener: HTMLElement | null) => {
    panelOpener.current[p] = opener;
    lastOpened.current = p;
    if (p == "sb") setSb(true);
    else setCh(true);
    pendingFocus.current = () => (p == "sb" ? sbCloseRef.current : chCloseRef.current);
  };
  const closePanel = useCallback((p: Panel) => {
    if (p == "sb") setSb(false);
    else setCh(false);
    if (lastOpened.current == p) lastOpened.current = null;
    // Focus returns to the button that opened it (the ☰ button / "Ask about your plans").
    pendingFocus.current = () =>
      (panelOpener.current[p]?.isConnected ? panelOpener.current[p] : null) ??
      (p == "sb" ? hambRef.current : askRef.current);
  }, []);

  // Move focus after the DOM has the target (opened panel, reappeared button, opener).
  useEffect(() => {
    const f = pendingFocus.current;
    if (!f) return;
    pendingFocus.current = null;
    const el = typeof f == "function" ? f() : f;
    if (el?.isConnected) el.focus();
  });

  // Esc closes the viewer first, then the panel that holds focus, then the last opened one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key != "Escape") return;
      if (viewer) {
        e.preventDefault();
        closeViewer();
        return;
      }
      if (screen != "results") return;
      const a = document.activeElement;
      let p: Panel | null = null;
      if (sb && sidebarRef.current?.contains(a)) p = "sb";
      else if (ch && chatRef.current?.contains(a)) p = "ch";
      else if (lastOpened.current && (lastOpened.current == "sb" ? sb : ch)) p = lastOpened.current;
      else if (sheets) p = sb ? "sb" : ch ? "ch" : null;
      if (p) {
        e.preventDefault();
        closePanel(p);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer, screen, sb, ch, sheets, closeViewer, closePanel]);

  // Full-screen sheets and the viewer lock the page behind them.
  const locked = viewer != null || (screen == "results" && sheets && (sb || ch));
  useEffect(() => {
    if (!locked) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [locked]);

  /* ---------- measurements: plan columns that fit, toolbar height for the sticky table header ---------- */
  useIsoLayoutEffect(() => {
    if (screen != "results") return;
    const m = mainRef.current;
    const tb = toolbarRef.current;
    if (!m || !tb) return;
    const measure = () => {
      setMainW(m.clientWidth);
      appRef.current?.style.setProperty("--tb", tb.offsetHeight + "px");
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(m);
    ro.observe(tb);
    return () => ro.disconnect();
  }, [screen]);

  // Changing the filter scrolls to the filter bar and flashes it once.
  useEffect(() => {
    if (!flashTick) return;
    const f = filterRef.current;
    if (!f) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tbh = toolbarRef.current?.offsetHeight ?? 0;
    window.scrollTo({ top: f.getBoundingClientRect().top + window.scrollY - tbh - 12, behavior: reduce ? "auto" : "smooth" });
    f.classList.remove(s.flash);
    void f.offsetWidth;
    f.classList.add(s.flash);
    const t = setTimeout(() => f.classList.remove(s.flash), 1000);
    return () => clearTimeout(t);
  }, [flashTick]);

  /* ---------- derived ---------- */
  const selected = M.selectedPlans(order, loaded, sel);
  const phone = mainW < 700;
  const cap = M.capacity(mainW);
  // Phone: two plan columns on screen, swipe for the rest. Wider: as many as fit (the demo's rule).
  const ids = phone ? selected : selected.slice(0, cap);
  const showNote =
    selected.length > cap
      ? phone
        ? `Showing ${cap} of ${selected.length} at a time — swipe the table for the others`
        : `Showing ${cap} of ${selected.length} — close the sidebar or chat to see all`
      : "";

  const modeLabel = selected.length == 1 ? "Your plan" : "Comparing plans";

  const togglePlan = (p: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const toggleDoc = (docId: string) =>
    setSel((prev) => {
      const d = M.docById(docId);
      const on = d.plans.some((p) => prev.has(p));
      const n = new Set(prev);
      d.plans.forEach((p) => (on ? n.delete(p) : n.add(p)));
      return n;
    });
  const addDocument = () => {
    setAdding(true);
    setTimeout(() => {
      setLoaded((l) => (l.includes("travel") ? l : [...l, "travel"]));
      setAdding(false);
    }, 1500);
  };
  const changeCut = (c: DemoTier) => {
    setCut(c);
    setFlashTick((t) => t + 1);
  };

  return (
    <DemoContext.Provider value={actions}>
      <div className={cx(s.root, displayFont.variable, bodyFont.variable)} data-demo-root>
        {!live && (
          <div className={s.strip}>
            <span className={s.demoLabel}>
              <FlaskConical size={12} aria-hidden />
              Demo data
            </span>
            <span>
              This is a demo with invented plans. Every page link opens a <b>demo PDF</b>, not a real insurance
              document.
            </span>
          </div>
        )}
        <header className={s.site}>
          <div className={s.siteIn}>
            <button type="button" className={s.brand} onClick={() => go("home")} aria-label="Insurance Simplified home">
              {/* eslint-disable-next-line @next/next/no-img-element -- the 30px logo needs no optimisation */}
              <img src="/insurance-simplified-icon.png" alt="" />
              <span className={s.wordmark}>
                Insurance<b>Simplified</b>
              </span>
            </button>
            <div className={s.topright}>
              <span className={s.tagline}>Document-first. Evidence-led.</span>
              {!live && (
                <span className={s.headerTag}>
                  <FlaskConical size={14} aria-hidden />
                  Demo data
                </span>
              )}
            </div>
          </div>
        </header>

        {screen == "home" && (
          <DemoContext.Provider value={demoActions}>
            <Landing go={go} />
          </DemoContext.Provider>
        )}
        {screen == "upload" &&
          (live ? (
            <LiveUpload
              files={files}
              rejected={rejected}
              consent={consent}
              onAdd={(added) => {
                const r = checkFiles(files, added);
                setFiles(r.files);
                setRejected(r.rejected);
              }}
              onRemove={(i) => setFiles((f) => f.filter((_, j) => j !== i))}
              onConsent={setConsent}
              onRead={read}
              go={go}
            />
          ) : (
            <UploadScreen go={go} />
          ))}
        {screen == "reading" &&
          (live ? (
            <LiveReading
              names={jobs.length ? jobs.map((j) => j.filename) : files.map((f) => f.name)}
              jobs={jobs}
              onCancel={cancelRead}
              phase={phase}
              error={readError}
              M={bundle ? M : null}
              incomplete={incomplete}
              onResults={() => go("results")}
              onRetry={read}
              onStartOver={() => go("upload")}
            />
          ) : (
            <ReadingScreen loaded={loaded} go={go} />
          ))}
        {screen == "find" && <FindDocuments country={ctry} onCountry={setCtry} />}
        {screen == "results" && (!live || bundle) && (
          <div className={cx(s.app, !sb && s.nosb, !ch && s.noch)} ref={appRef}>
            {sb ? (
              <aside
                className={s.sidebar}
                aria-label="Documents and needs"
                ref={sidebarRef}
                {...(sheets ? { role: "dialog", "aria-modal": true } : {})}
              >
                <Sidebar
                  loaded={loaded}
                  sel={sel}
                  selected={selected}
                  adding={adding}
                  needs={needs}
                  closeRef={sbCloseRef}
                  onClose={() => closePanel("sb")}
                  onToggleDoc={toggleDoc}
                  onTogglePlan={togglePlan}
                  onAdd={addDocument}
                  addNote={
                    live
                      ? "Adding a document to these results isn't available yet. To compare more plans, start again with all the PDFs."
                      : undefined
                  }
                  onNeed={(i, patch) => setNeeds((n) => n.map((x, j) => (j == i ? { ...x, ...patch } : x)))}
                />
              </aside>
            ) : (
              <div />
            )}
            <div style={{ minWidth: 0 }}>
              <div className={s.toolbar} ref={toolbarRef}>
                <button
                  type="button"
                  className={s.hamb}
                  ref={hambRef}
                  aria-expanded={sb}
                  aria-label={`Documents and needs: ${loaded.length} documents, ${selected.length} plans`}
                  onClick={(e) => (sb ? closePanel("sb") : openPanel("sb", e.currentTarget))}
                >
                  <Menu size={18} aria-hidden />
                  <span className={s.badge}>
                    {loaded.length} documents, {selected.length} plans
                  </span>
                </button>
                {!phone && (
                  <>
                    <span className={s.mode}>{modeLabel}</span>
                    <span className={cx(s.muted, s.small)} aria-live="polite">
                      {showNote}
                    </span>
                  </>
                )}
                <span className={s.toolBreak} aria-hidden />
                <span className={s.toolRight}>
                  <button type="button" className={s.quiet} aria-pressed={compact} onClick={() => setCompact((c) => !c)}>
                    {compact ? "Explained view" : "Compact view"}
                  </button>
                  <label className={cx(s.quiet, s.small)}>
                    Show
                    <select value={cut} onChange={(e) => changeCut(+e.target.value as DemoTier)}>
                      {TIERS.map((g) => (
                        <option key={g} value={g}>
                          {CUTN[g]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!ch && (
                    <button
                      type="button"
                      className={cx(s.btn, s.sm, s.askBtn)}
                      ref={askRef}
                      aria-label="Ask about your plans"
                      onClick={(e) => openPanel("ch", e.currentTarget)}
                    >
                      <MessageCircle size={16} aria-hidden />
                      <span className={s.askLabel}>Ask about your plans</span>
                    </button>
                  )}
                </span>
              </div>
              <main className={cx(s.main, compact && s.compact)} ref={mainRef}>
                {phone && (
                  <div className={s.phoneHead}>
                    <span className={s.mode}>{modeLabel}</span>
                    <span className={cx(s.muted, s.small)} aria-live="polite">
                      {showNote}
                    </span>
                  </div>
                )}
                {live && incomplete && <ChecksNotice />}
                <ResultsMain
                  ids={ids}
                  needs={needs}
                  cut={cut}
                  swipe={phone && ids.length > 1}
                  animateGauges
                  filterRef={filterRef}
                  onShowEverything={() => changeCut(3)}
                  onMove={(id, dir) => setOrder((o) => M.movePlan(o, selected, id, dir))}
                  onOpenSidebar={(opener) => openPanel("sb", opener)}
                />
              </main>
            </div>
            {ch ? (
              <aside
                className={s.chat}
                aria-label="Ask about your plans"
                ref={chatRef}
                {...(sheets ? { role: "dialog", "aria-modal": true } : {})}
              >
                <ChatPanel
                  selected={selected}
                  log={log}
                  suggestions={chat.suggestions
                    .map((text, i) => ({ text, i }))
                    .filter(({ text }) => !live || !/Gold plan/.test(text))}
                  closeRef={chCloseRef}
                  onClose={() => closePanel("ch")}
                  onAsk={(i) => setLog((l) => [...l, chat.ask(i, selected)])}
                  onTyped={(q) => setLog((l) => [...l, chat.typed(q, selected)])}
                />
              </aside>
            ) : (
              <div />
            )}
          </div>
        )}
        {viewer && (
          <DemoContext.Provider value={viewer.demo ? demoActions : actions}>
            <PdfViewer target={viewer.t} onClose={closeViewer} />
          </DemoContext.Provider>
        )}
      </div>
    </DemoContext.Provider>
  );
}

const SESSION_KEY = "insurance-simplified:v2-session";
function remember(id: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, id);
  } catch {
    /* storage blocked: a reload starts over */
  }
}
function recall(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function forget() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to forget */
  }
}
