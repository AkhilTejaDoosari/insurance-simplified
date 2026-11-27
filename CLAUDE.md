@AGENTS.md

## Claude Code notes

- V2 is the current plan: `docs/roadmap.md` §0 and `docs/v2/`; begin there.
- Two services: npm commands run in `web/`, uv commands in `engine/`.
- Keep the task list to the current work package's acceptance criteria.
- Real-PDF evaluation needs `REAL_PDFS_DIR` set to the owner's local corpus; if it
  is unset, report those suites as SKIPPED.
- Recovery refs that must never be deleted or rewritten: `backup/*` branches,
  `refs/wip/*`, tags `recovery-pre-ui-2026-09-21` and `baseline/pre-v2-2026-11-26`.
