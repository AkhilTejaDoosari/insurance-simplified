# Insurance Simplified — V2 scope (LOCKED 2026-11-26)

**Version note (19:10):** this plan was written as "V1" in the planning documents of 2026-11-25/26. The repository already had a V1 (Sep–Oct 2026) and V1.1 milestones on a TypeScript-only architecture, so the plan is **V2** (decision D-039). Same content; only the name changed. Checkpoints: **V2-preview** and **V2.0**.

Amendments: 10:57 — dynamic categories, importance groups and cutoff; 11:00 — plan levels; 13:05 — contacts and email drafts, find-my-documents guide, no-documents options, results-screen fixes; 17:35 — document-relative comparison model replaces checklists, deductible/limit basis rule, explanations always visible; 17:45 — collapsible sidebar and chat drawer layout; 18:46 — UI design locked (`docs/v2/design.md`), light theme in logo colors, visible "Show" filter bar; 19:10 — renamed V2.

This file decides **what is built in V2**. Decisions D-032…D-039 in `docs/decisions.md` record how; the category backbone, plan levels and one-way doors are in the owner's planning documents (claude.ai project "Insurance Simplified"; where they mention expected lists, "Not stated" rows or Tier 1 rows always shown, **this file wins**); **look and feel in `docs/v2/design.md`** (the approved HTML demo in `docs/v2/demo/` is the visual reference for `web/`); the audit and migration plan in `docs/v2/audit-2026-11-26.md`. Anything not listed under "In V2" is on the Not-now list. New ideas go to the Not-now list by default; moving one into V2 needs an explicit owner decision recorded here.

**Terminology:** *importance groups* = must know / important / good to know / admin. *Levels* = plan levels inside one family (Basic, Gold, Platinum…). *Network tier* = in-network / out-of-network. *Basis* = what an amount applies to (per year, per incident/illness/injury, per visit, per period of coverage/trip, lifetime). *Not mentioned* = the document does not state a benefit that another selected document states (engine state `not_mentioned`).

## What V2 is
A live web app where anyone in the US can upload 1–5 health-plan PDFs, understand one plan in plain English or compare several, see how well each plan matches their needs, ask questions, and know what to ask the insurer next — where every fact on screen is verified against the document and cited, every insurance term is explained where it appears, and every reliability claim is a measured number.

## Architecture (locked)
- **web/** — Next.js + React + TypeScript on Vercel: upload, processing view, results (understand / compare), match gauges, chat drawer, document viewer, find-my-documents guide.
- **engine/** — Python 3.12+ + FastAPI + Pydantic v2, in Docker: parse → classify → identify plan families and levels → extract (discover benefits) → match the same benefit across documents → verify (two keys) → search before "not mentioned" → group (in all / in some / only one) and rank → comparison facts → match score → chat routing and answer checking → durable jobs. Every fact and score the user sees comes from the engine.
- **contracts/** — engine OpenAPI is authoritative; TypeScript types generated from it.
- **Data** — Supabase Postgres + pgvector + Storage; session data deleted after 24 hours.
- **AI** — provider-agnostic client. Extraction model and verification judge from **different model families**. Start with Nemotron 3 Ultra; Claude Sonnet 5.5 and a ceiling model (Fable 5.2 / Opus 5.5) tested later via a development gateway on public PDFs only; production models chosen on the validation set; live app on direct provider accounts.
- **Engineering from the first engine package** — Docker, GitHub Actions CI (lint, types, pytest, Vitest, contract tests, secret scanning, license check, scorecard on dev fixtures), structured logs with a trace id per document. Terraform for the engine host once the host is chosen (V2 includes it).
- Parser library and engine host: chosen by the parser evaluation on the validation set (current TS reader, pdfplumber, PyMuPDF, Docling, Nemotron Parse, and hosted LlamaParse / Reducto / Azure DI as ceiling).

## In V2
**Market and documents**
- Market: **US**. Design stays market-neutral (market, currency, language fields; US is the first market pack).
- Full-support targets: **SBC (benefits summaries), international student plans, travel medical plans**. Certificates/ID cards: recognized, with "this document only covers X — upload the full plan document for the rest". Marketing brochures: conditional. Unknown: best effort, labelled. Scanned PDFs: detected, user told, not read. Web pages saved as text PDFs are accepted like any PDF (source shown as "insurer web page, saved on DATE").

**Engine**
- Normalized, versioned document model (reading order, tables with row/column headers, footnotes, coordinates).
- **Plan families and levels:** plan identity = family + level + source document; levels discovered from table column headers and section headings; every level is a full plan; each fact is *shared* (all levels) or *level-specific* (bound by its column header/section); levels kept in document order, never ranked by name.
- **Discover, don't expect:** extraction discovers every benefit each document states, in its own wording. **No external checklist or template defines what a document "should" contain.**
- **Cross-document matching:** the same benefit worded differently across documents ("Emergency Room – Illness" / "Accident & Sickness ER") is grouped into one row using the category dictionary (synonyms, hierarchy, importance group, default weight). The dictionary is used only to match wording and order rows, never to expect content. Matching is verified (synonym match or judge confirmation at ≥ the matching cutoff, start 0.9); below the cutoff → kept separate, with "possibly the same as …" shown when two separate items look alike. Unmatched labels logged for owner review to grow the dictionary.
- **Comparison sections:** every benefit lands in exactly one of: **In all your plans** (stated by every selected plan — the main table) · **In some of your plans** (stated by 2+ but not all; other cells say "not mentioned in this document") · **Only in one plan** (one card per plan). With one plan selected: everything the document states, ordered by importance.
- **Search before "not mentioned":** before a cell says "not mentioned in this document", the engine searches that document for the benefit (keywords, synonyms, meaning-based search). A candidate passage it can't verify → **Couldn't confirm — check page X**.
- **Basis rule (deductibles, limits, copays, maximums):** every amount carries its basis from the document (per year — calendar or policy; per incident/illness/injury; per visit; per period of coverage/trip; lifetime) plus whether copays count toward the deductible when stated. An amount whose basis the document doesn't make clear → Couldn't confirm. Amounts are never shown without their basis. Same number on a different basis is marked **"different basis"**, never "same" and never merged.
- **Importance groups and cutoff:** must know · important · good to know · admin. Order within each section = group, then row weight (dictionary weight × user must-have boost × plans-differ boost). Default view shows must know + important; user changes it with the **Show** filter (Must know only · Must know + important · Everything); a filter bar always states how many benefits are shown and hidden per group, with "Show everything". Unrecognized benefits default to "good to know". The match score always uses every benefit, whatever the filter.
- **Answers kept apart:** Verified value · Not covered (explicit exclusion) · Not mentioned (another selected document states it; this one doesn't, after search) · Couldn't confirm · Conflicting.
- Extraction returns value + qualifiers (network tier, person level, basis/period, condition, plan level) + semantic fields (negation, exceptions, conditions, limits) + evidence span.
- **Two-key verification:** code proves the structural facts (span exists, numbers present, label and number in the same row/column by layout, level column header matches); an independent judge model from a different family confirms meaning incl. conditions and basis; both must agree.
- **Contacts as facts:** insurer phone, email, website and claims/mailing address, each with a purpose label (customer service, claims, pre-approval) and source page, verified like values; government/regulatory boilerplate contacts filtered out.
- Durable job lifecycle (Uploaded → Parsing → Extracting → Verifying → Completed / Failed / Cancelled) on a Supabase job table: checkpoints, safe retries, progress, cancellation.
- Parser sandboxing: per-document time, memory and page limits; separate process.

**Product**
- Two entry paths: "Understand my plan" (1 PDF) and "Compare plans" (2–5 PDFs), plus "I don't have my documents" (guide below). One PDF with several levels opens in "compare levels" by default.
- **Look and feel:** as locked in `docs/v2/design.md` — light theme only, logo red/blue with green and amber for states, readable evidence highlights (light blue tint, dark text, blue underline), Bricolage Grotesque + Atkinson Hyperlegible.
- **Results layout:** a **collapsible left sidebar** opened by a ☰ button with a count badge ("3 docs · 5 plans") — holds document and level checkboxes, "+ Add document", your needs, and the explained/compact switch; a **collapsible right chat drawer** opened by "Ask"; with both closed the comparison uses the full width. Row-label column and plan header row stay pinned while scrolling. Phone: sidebar and chat open as full-screen panels; 2 plans visible, swipe for the rest.
- Up to 5 PDFs per session; columns are plans (levels count as plans). **Columns shown = as many as fit at a readable width, up to 5** (5 on a laptop/desktop with both panels closed; fewer with panels open, with "Showing 3 of 5 — close the sidebar to see all"); 2 on phone; "N plans found, showing M" — nothing dropped silently.
- **Selection controls (in the sidebar):** a checkbox per document (turns all its levels on/off) and per level, with explicit checked/unchecked state and a "Showing: …" line; **"+ Add document"** (up to 5 total; only the new document is processed; existing results stay on screen). **Reorder columns left to right** with a drag handle or ← → on each column header, remembered for the session.
- 1 selected → understand mode, 2+ → compare mode; no re-processing. Same level name in two families always shown with the family name.
- Table header: family name spanning its level columns, level name below; values shared by every level of a family merge into one cell ("same for all 4 levels").
- Sections "In all your plans" / "In some of your plans" / "Only in one plan"; "differs" and "different basis" markers; document's own wording shown under each value.
- **Explanations always visible (default view):** every insurance term in a row label or value (deductible, coinsurance, copay, out-of-pocket maximum, in-network, pre-existing condition, waiting period, sum insured, …) has a one-line plain explanation directly under it, labelled "general info"; every value has a plain sentence built from a template that matches its basis (e.g. per year: "You pay the first $250 of covered care each year, across all visits"; per incident: "You pay $250 for each new illness or injury"). A "compact view" toggle hides explanations for experienced users; default is explained.
- Source behind a toggle with PDF page and printed page; clicking a page link opens the PDF in a side viewer at that page.
- "What happens if…" situations in understand and compare modes, built from verified values and their basis (e.g. "Two separate illnesses this year: Plan A — you pay the $250 deductible once; Plan B — twice").
- **Processing counts per document:** "Found N benefits" (and, when comparing, "X in all plans · Y in some · Z only here"), plus couldn't confirm and conflicting counts. No absence counts against any checklist.
- **Match gauge (must-have):** per plan/level, % match to needs, from Verified facts only; unconfirmed shown separately; default US needs (dictionary categories) with **editable thresholds** and a must-have / nice-to-have toggle; a plan failing a must-have shows a warning; must-haves rise to the top of their group; needs compare like basis with like basis (different basis shown, not scored); a need no selected document mentions is left out of the score with "no document mentions X"; breakdown always under the gauge; arc colored green / amber / red per the design; never "buy this plan".
- **Chat drawer** (right side, collapsible; open on the first results view; "Ask" button when closed; full-screen panel on phone). Answers name the plan/column they come from. Scoped to selected plans; routes: comparison (from the verified grid), document fact (cited), calculation (code, only when cost order and basis are stated, assumptions labelled), general term (glossary), not mentioned ("not mentioned in the document", never "not covered"), refuse. Ambiguous plan names → asks which. Route tag on every answer.
- **Contact the insurer card** per plan (verified contacts with purpose and page) and **email drafts** opened in the user's own mail app (never sent by the app, no email collected): (a) "Ask about this plan" — plan name, blank for member number, and every Couldn't confirm / Not mentioned / Conflicting row as a question; (b) "Request the plan documents" — US: Summary of Benefits and Coverage; generic: full written terms before buying.
- **Find-my-documents guide** ("I don't have my documents"): where documents usually are by situation; save-as-PDF instructions for insurer web pages; a phone question list (answers never shown as verified facts); and a **prompt generator** for the user's own AI (country, state/city, ZIP/PIN, age, who is covered, how coverage is obtained with country-specific choices, optional requirement to meet, what matters most). **Never asks immigration status or ID numbers.** Prompt demands official sources only, direct PDF links actually opened, "say so if you can't browse", no ranking. Shown with the "AI search finds some plans, not every plan … can't tell you whether better plans exist" notice and "If an insurer won't give you its plan terms in writing, treat that as a warning sign." Template only — no AI cost.
- Upload checks (type, size, pages, text PDF), "deleted after 24 hours" notice.
- **Open decision (owner):** one-plan mode — keep or drop a separate, clearly advisory "Worth asking the insurer" box for a few must-know topics the document doesn't mention.

**Operations and safety**
- Per-visitor rate limits, bot protection, daily AI spend cap (start $5/day) with a "busy, try again later" message, provider budget alerts.
- Supabase keep-alive or paid plan so the live link never pauses; engine cold-start measured against the 90 s target.
- Prompt-injection defense (document text is data, never instructions; all outputs schema-validated), service-to-service auth, session isolation, verified session deletion (storage + DB + vectors, tested); document text never logged.
- Information, not advice; no selling, no affiliate links, no contact collection.

**Evaluation**
- Datasets kept apart: dev fixtures · **validation ≥ 15 PDFs** (≥ 5 per full-support type, incl. multi-level documents) · **blind batch A ≥ 15** (sealed) · **blind batch B ≥ 15** (sourced and sealed; keys written only if A fails).
- Answer keys: a model pre-fills, the owner settles every disagreement against the PDF; disagreement rate recorded. Keys record every benefit each document states (label, category, value, basis, qualifiers, level, page, span) and contacts with purpose — so "in all / in some / only one / not mentioned" can be scored for any combination of documents.
- Chat grading: fixed question set per document written before the run; a model pre-grades, the owner decides every answer marked wrong or uncertain plus a 20% random sample of the rest.
- Sourcing check first: if a type can't reach 5 + 5 + 5 public PDFs, it can't be claimed in V2.
- Gate policy: a blind batch is run once per release candidate; on failure, report it, move it to validation, use the next batch. A type that fails twice ships as "conditional" with its measured numbers.

## Release checkpoints inside V2
- **V2-preview** — live link; validation scorecard published with counts, whatever the numbers; 0 wrong Verified values on validation.
- **V2.0** — all gates pass on a blind batch for each claimed type; user test done (3 people who didn't build it, 5 standard questions, 0 wrong facts seen, every term on screen understood without outside help).

## V2.0 gates (blind batch; raw counts per type)
Verified precision 100% (stated as "0 wrong in N") · core recall ≥ 95% (benefits stated in the document and shown as Verified) · citation accuracy 100% · supported-answer correctness 100% · supported answer rate ≥ 95% · unsupported refusal 100% · silent plan loss 0 (incl. levels) · level-binding errors 0 · false shared-value merges 0 · silent benefit loss 0 · **false "not mentioned" 0** (document states it, app said not mentioned) · **false "unique" 0** (same benefit shown as two separate items) · **basis errors 0** (wrong or missing basis; different bases shown as same) · cross-document matching errors 0 · excluded-vs-not-mentioned confusions 0 · eligibility errors 0 · contact errors 0 · match-score correctness 100% · currency/number-format errors 0. Operational: p95 ≤ 90 s for a 40-page document; ≤ $0.05 AI cost per document; live link passes a daily test upload 7 days running; 5 plans readable side by side at 1366 px width with both panels closed (Playwright screenshot check).

## Not now (after V2, in this order unless the owner reorders)
1. **India market pack** (bring-your-own-documents only; own validation + blind sets; reviewer who reads the documents; India request-documents wording: policy wording + Customer Information Sheet; prompt generator India choices; re-check that the prompt generator stays outside IRDAI web-aggregator scope).
2. **Personalization intake** (short questions → weighted needs; chat-suggested profile changes on confirmation).
3. **Requirements packs** (school waiver, visa, employer rules from a user-provided document or page).
4. **Plan library** ("Find plans for me"), US first; India library stays off until the IRDAI web-aggregator question is resolved; US licensing check before launch.
5. **OCR** for scanned PDFs and screenshots.
6. **Save a web page from a link** (app stores a dated copy of an insurer page).
7. **Other markets** and other languages.
8. **Other insurance categories** (auto, pet, home, renters).
9. **Saved results** — "export as PDF" first; no accounts. (The existing export code is parked, D-037.)
10. **Cost comparison** (premiums + likely yearly cost) — only where documents state prices.
11. **User-entered values** (e.g. answers from a phone call) — only if ever added, always labelled "entered by you, not from a document", never counted as verified or in the match score.
12. **Dark theme** (only with its own contrast check for highlights and states).

## Order of work (work packages: `docs/v2/audit-2026-11-26.md` §8; status: `docs/roadmap.md` §0)
Audit (done) → preserve + baseline (WP0) → consolidate into the monorepo (WP1, done on `v2/foundation`) → sourcing check, seal blind batches, build validation keys (WP2) → engine skeleton with CI/Docker/logging/contract and one-way-door guardrails (WP3, done on `v2/foundation`) → parser evaluation, picks parser + host (WP4) → jobs (WP5) → plan families/levels (WP6) → category dictionary, discovery, cross-document matching (WP7) → two-key verification (WP8) → comparison and scoring (WP9) → chat router (WP10) → web cut-over to the locked design (WP11) → operations and safety (WP12) → V2-preview (WP13) → blind run → V2.0 (WP14).

## Not in scope of any decision here
Dates. V2 ships when its checkpoints pass.
