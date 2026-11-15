# Archive — history, not rules

> Nothing in this folder is authoritative. The current rules are the eight
> documents in `docs/`. Files here keep their original text (moved with
> `git mv`, so `git log --follow` shows full history).

| Folder | Contents | Replaced by |
| --- | --- | --- |
| `superseded/` | V1 locked/draft docs: PRODUCT, USER_FLOWS, DOMAIN, ACCEPTANCE (incl. 2026-10-22 gate run), ARCHITECTURE, DATA_MODEL (target tables), API (target routes), REPO_MAP, SECURITY (incl. §6.1 SQL grant audit), DEPLOYMENT, RELIABILITY, OBSERVABILITY, PLAN, ENGINEERING_STATE (2026-11-14 recovery record), V1_1_REVIEW_PACKAGE (V1.1 spec), DESIGN, UI-IMPLEMENTATION-CONTRACT, AGENTS (2026-10-30) | `product`, `architecture`, `evidence-core`, `experience`, `quality`, `operations`, `roadmap`, root `AGENTS.md` |
| `reports/` | Research and evaluation reports: P1/P2 experiments and reviews, FEP replay, real-PDF diagnostics, unseen-document generalization, Sonnet engine evaluation, RAG gap analysis and audits, extraction quality baseline, and the 2026-11-15 feasibility review and documentation governance plan | Findings that still hold are in `evidence-core.md` (defect register), `quality.md` (benchmarks, gates) and `roadmap.md` |
| `plans/` | Completed or abandoned agent plans (2026-10) | `roadmap.md` |
| `spec-kit/` | Spec-kit feature `001` and its constitution (2026-09) | `product.md`, `evidence-core.md` |

Evaluation dataset records stay with their data in `evals/`
(`BASELINE.md`, `v2-MANIFEST.md`).
