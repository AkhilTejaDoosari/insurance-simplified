# Quickstart: Validating Insurance Plan Comparison

**Date**: 2026-09-16 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Validation guide only — no implementation code. Each flow lists
prerequisites, steps, and expected outcomes with links to contracts.

## Prerequisites

- App running locally; 2+ sample English PDFs with known differing values
  (e.g. deductibles that disagree, one fact missing everywhere, one vague
  statement, one qualifier-bearing value like "$250 in-network /
  $500 out-of-network").
- Fixtures recorded: which file/page/quote backs each expected cell.

## Flow 1 — Upload to comparison table (P1)

1. Upload 2 PDFs + basic context.
2. Wait for the table (budget: under 5 minutes per SC-001).
3. **Expect**: ~20–30 rows; every row carries exactly one verdict from the
   closed enum ([comparison-schema](contracts/comparison-schema.md));
   CONFLICTED rows show both values; missing facts show NOT STATED.
4. **Expect**: qualifier-bearing values display in full, never collapsed.

## Flow 2 — Cell evidence inspection (P1)

1. Click several populated cells, including one CONFLICTED row.
2. **Expect**: evidence panel shows source document, page, and exact quote
   matching the fixture (SC-002: 100% of populated cells).

## Flow 3 — Chat answers and refusals (P2)

1. Ask a question the documents answer → **expect** a cited answer per
   [chat-api](contracts/chat-api.md).
2. Ask a question nothing supports → **expect** the fixed refusal shape, no
   generated claims (SC-005: 100% refusal on evidence-absence set).

## Flow 4 — Insurer questions (P2)

1. With NOT STATED / CONFLICTED / NEEDS VERIFICATION rows present, open
   suggestions.
2. **Expect**: each suggestion names its motivating fact and documents.

## Flow 5 — No-documents checklist (P3)

1. Enter with no documents, provide context.
2. **Expect**: actionable checklist (what to look for + documents to
   collect) in under 3 minutes (SC-006), with a route back to upload.

## Flow 6 — Session lifecycle and export

1. Download the export → **expect** shape per
   [export-file](contracts/export-file.md) with lossless qualifiers.
2. Close the session → **expect** uploads and extracted data deleted; no
   server-side state remains.

## Constitution review checklist (run before merge)

- [ ] No row renders outside the five verdict states (principle I).
- [ ] Extraction and chat run on separate paths with separate prompts
  (principle II — verify in code, not just docs).
- [ ] Qualifier fixtures pass, including in/out-of-network splits
  (principle III).
- [ ] Evidence-absence question set returns only refusals (principle IV).
- [ ] No external data source, plan DB, or recommendation text anywhere
  (principle V).
