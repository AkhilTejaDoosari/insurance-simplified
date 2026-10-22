# Insurance Simplified Design System (Existing UI)

## 1. Atmosphere & Identity

Quiet, evidence-first insurance reading: a pale canvas, understated blue
actions, and compact side-by-side facts. The original PDF page is always one
click away. Phase P1 preserves the existing interface while adding a one-PDF
understanding state; Phase P2 may change group navigation after approval.

## 2. Color

`app/globals.css` owns the palette: `--bg` #f5f6f3, `--surface` #ffffff,
`--surface-tint` #eef2ee, `--ink` #1c2833, `--muted` #5b6770, `--line`
#dce1de, `--line-strong` #c3cac6, `--action` #255f99, `--focus` #1f4f80.
Status tokens are `--ok-*`, `--bad-*`, `--none-*`, and `--warn-*`.
The existing UI has one light theme; this document records it, not a new theme.

## 3. Typography

`--font` is Instrument Sans with system fallbacks. Root text is 15px/1.5;
headings use 1.75rem, 1.2rem, 1rem, and 0.9rem. Values use tabular numerals.
Labels are sentence case; status labels use the established verdict vocabulary.

## 4. Spacing & Layout

The 4px rhythm uses 8, 12, 16, 20, 24, and 28px steps. `--measure` caps
content at 1440px; `--gutter` is 24px. Results use a main grid plus 360px
chat rail, collapsing to one column under 900px. Tables own their horizontal
scroll rather than squeezing tier values into unreadable columns.

## 5. Components

- **Card** (`.card`): white bordered surface, 24px inset; intake and results.
- **Panel** (`.panel`): tinted supporting surface for chat; preserve focus
  order when stacked on narrow screens.
- **Button** (`.btn`): blue primary, visible hover/focus/disabled states;
  loading state disables repeat submission and announces progress.
- **Input/select** (`.input`, `.select`): visible label and focus outline;
  validation errors appear inline with `role="alert"`.
- **Comparison table** (`.comparison`, `.table`): section navigation, tier
  selection, per-value evidence links, honest `Not stated`, and Verify & Contact.
  One PDF uses one document column or its internal tier columns.
- **Verdict badge** (`.verdict`): separate tokens for supported, excluded,
  not stated, and verification states; verdicts never replace source links.

## 6. Motion & Interaction

Existing hover feedback runs at 120ms; the processing spinner uses a transform
animation. New copy/branching introduces no animation. Keep reduced-motion
support and visible keyboard focus.

## 7. Depth & Surface

Mixed, restrained surface treatment: a border separates cards and tables;
tonal tint distinguishes supporting panels. The existing welcome choice has a
subtle hover shadow. Do not add decorative gradients or new elevations for P1.

## 8. Accessibility Constraints & Accepted Debt

Target keyboard-reachable form controls, labelled tier selectors, live status,
inline error alerts, and visible focus. Evidence links name the fact, source,
and page. Existing light-only theme and horizontal table scroll remain
pre-existing design debt; they are not expanded in this product-contract phase.
