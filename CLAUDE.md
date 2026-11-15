@AGENTS.md

## Claude Code notes

- The current milestone and its exact tasks are in `docs/roadmap.md`; begin there.
- Keep the task list to the milestone's numbered responsibilities.
- Real-PDF evaluation needs `REAL_PDFS_DIR` set to the owner's local corpus; if it
  is unset, report those suites as SKIPPED.
- Recovery refs that must never be deleted or rewritten: `backup/*` branches,
  `refs/wip/*`, tag `recovery-pre-ui-2026-09-21`.
