# Insurance Simplified Design System (V1.1 foundation)

## 1. Atmosphere & Identity

Adaptive Medical Minimal: quiet, evidence-first reading with restrained brand
red and blue interactive controls. The original PDF page remains one click away.
The approved master logo remains unchanged; the small transparent icon is a
derived crop for dark surfaces and browser icons, not a replacement brand.

## 2. Color

`app/globals.css` owns semantic tokens. Light: background #F7F8FA, surface
#FFFFFF, ink #171B24, line #E1E5EB, interactive blue #315EDB, brand red
#CF3043. Dark (`prefers-color-scheme`): background #111318, surface #1D2028,
ink #F7F8FA, line #373D48, accessible interactive blue #98AFFF and brand
red #ED4658. Supporting surfaces, row stripes, focus, and status tokens have
separate theme values. `--ok-*` is reserved for supported positives,
`--warn-*` for potential conflicts, `--bad-*` for explicit exclusions/errors,
`--none-*` for unknown/not stated. Status text is mandatory; color is not enough.

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

- **Card** (`.card`): bordered semantic surface, 24px inset; intake and results.
- **Panel** (`.panel`): tinted supporting surface for chat; preserve focus
  order when stacked on narrow screens.
- **Button** (`.btn`): blue primary, visible hover/focus/disabled states;
  loading state disables repeat submission and announces progress.
- **Input/select** (`.input`, `.select`): visible label and focus outline;
  validation errors appear inline with `role="alert"`.
- **Comparison table** (`.comparison`, `.table`): retains current V1 navigation
  and tier presentation until the approved later V1.1 workspace milestone.
  Per-value evidence links and honest `Not stated` remain mandatory.
- **Verdict badge** (`.verdict`): separate tokens for supported, excluded,
  not stated, and verification states; verdicts never replace source links.

## 6. Motion & Interaction

Existing hover feedback runs at 120ms; the processing spinner uses a transform
animation. Respect reduced motion and keep visible keyboard focus. Loading,
retryable errors, and unknown insurance states must remain distinct.

## 7. Depth & Surface

Mixed, restrained surface treatment: a border separates cards and tables;
tonal tint distinguishes supporting panels. The welcome choice has a subtle
hover shadow. Do not add decorative gradients or excessive elevation.

## 8. Accessibility Constraints & Accepted Debt

Target keyboard-reachable form controls, labelled tier selectors, live status,
inline error alerts, visible focus and sufficient contrast in both system
themes. Evidence links name the fact, source, and page. Existing horizontal
table-scroll and V1 document/tier columns remain debt until Milestone 4.
