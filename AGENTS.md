# AGENTS — working rules for this repository

Applies to every coding agent (Claude Code, OpenCode, …). The rules about the
product live in `docs/`; this file only says how to work and where to look.

## Start here

1. Read `docs/roadmap.md` → the **current milestone** and its section.
2. Read only the documents and sections that milestone names (table below).
3. `git status`, then inspect the code and run the relevant tests before editing.
4. Classify each requirement in scope as EXISTS / PARTIAL / MISSING / CONFLICT
   and implement the smallest missing delta. Reuse working code.

| Subject | Authoritative document |
| --- | --- |
| What we build, for whom, acceptance criteria (A-0xx, UX-xx), domain rules | `docs/product.md` |
| Components, state ownership, routes, data, code map | `docs/architecture.md` |
| Evidence/extraction invariants, trust-boundary tests, defect register | `docs/evidence-core.md` |
| Dashboard, comparison, chat, export, design system | `docs/experience.md` |
| Test layers, benchmarks, release gates, evidence levels | `docs/quality.md` |
| Security, privacy, deployment, reliability, observability | `docs/operations.md` |
| Milestones and current status | `docs/roadmap.md` |
| Why a rule exists (D-0xx) | `docs/decisions.md` |

`docs/archive/` is history. Do not read it unless a milestone names it; never
treat it as a rule.

## Non-negotiable

- **Never weaken the evidence contract:** page provenance, citation
  verification, evidence ids, the original-PDF viewer, fail-closed attribution.
  NOT STATED ≠ NO; different plan values ≠ CONFLICTED; missing context → ask.
- **Session scope before retrieval or model access.** A caller-supplied id is
  never authorization.
- **No secrets in output, logs, commits or docs.** Read variable names, never
  values (`.env.local`, keys, signed URLs, capabilities).
- **Never commit real insurance PDFs, their page text, or derived data.** They
  live outside git (`REAL_PDFS_DIR`).
- **Never change a test assertion to get green.** Report SKIPPED as skipped.
- **Do not count ADR reference implementations, plans or screenshots as
  implemented.** Use the evidence levels in `docs/quality.md` §1.
- Production state is never in `/tmp`, process memory or module globals.
- Provider calls stay behind adapters (`app/lib/llm`, `app/lib/rag`, `app/lib/storage`).

## Needs explicit owner approval in this session

Push, PR, merge, tag/release, deploy, cloud or billing changes, secret
rotation, paid API calls, new dependencies, new runtime components or stores,
schema migrations, changes to state ownership or the session-auth model,
changes to an authoritative rule, and starting the next milestone. Local
commits only when the task says so; inspect the staged file list first and
never stage `.omo/`, `.opencode/`, logs, evidence dumps or secrets.

## Stop and report when

Documents conflict (precedence: `operations.md` security → `evidence-core.md`
→ `product.md` → others; still stop) · the work needs an architecture change ·
a trust guarantee would weaken · a red test cannot be explained · the milestone
cannot finish without entering the next one.

## Checks

Focused tests → `npm test` → `npx tsc --noEmit` → `npm run build`; add
`npm run test:e2e` when a flow changes and `docker build` when runtime files
change. UI work also needs desktop/mobile, light/dark screenshots for owner
review.

## Milestone report (end every milestone with this, then stop)

```text
MILESTONE:   <id and name>
DONE:        <requirements/IDs moved, with status level>
FILES:       <changed files>
CHECKS:      <command → result, including SKIPPED>
ARCHITECTURE: NONE | REQUIRES APPROVAL: <what>
DOC UPDATES: <roadmap status rows changed; any rule change proposed>
RISKS:       <open items>
NEXT:        <one action>
STOPPED FOR OWNER APPROVAL
```
