# Insurance Simplified — V2 interface design (LOCKED 2026-11-26, D-038)

The owner approved the HTML demo as the visual and interaction reference for the V2 screens. Behaviour rules live in `docs/v2/scope.md`; this file fixes how it looks. Changes need an owner decision recorded here.

## Theme
- Light theme only (`color-scheme: only light`). The page does not follow the OS dark mode: in dark mode a yellow highlight became light text on yellow and was unreadable. A dark theme is on the Not-now list.
- Palette from the logo (red + blue), plus green and amber:

| Token | Hex | Use |
|---|---|---|
| mist | #F3F6FB | page background |
| paper | #FFFFFF | cards, tables, panels |
| ink | #14213D | text |
| ink2 | #4A5672 | secondary text |
| rule / rule2 | #DFE5EF / #BCC7D8 | borders |
| cobalt (logo blue) | #315EDB, soft #E9EFFD | buttons, links, focus, filter bar |
| marker | #D3E1FF + 2px #315EDB underline, ink text | evidence highlights (document wording) |
| signal (logo red) | #CF3043, soft #FDE9EB | Not covered, missed must-have, low score |
| leaf (green) | #1F7A5C, soft #E2F4EC | Verified, strong match |
| amber | #8A5300, soft #FFF1D9 | Couldn't confirm, different basis, middling match |
| slate | #56637A, soft #EDF1F6 | Not mentioned |

- The header carries a 3px red / blue / green stripe taken from the logo.
- Match gauge arc: green at 80% or more with no missed must-have; amber at 50–79%; red below 50% or with any missed must-have.
- All text/background pairs meet WCAG AA.

## Type
- Display: Bricolage Grotesque (headings, plan names, gauge numbers).
- Body: Atkinson Hyperlegible (legible numbers and fine print).

## Key screens
- **Landing:** a headline plus a document excerpt with highlighted clauses and plain-words margin notes linked to their page ("See it on page N").
- **Results:** ☰ sidebar (documents, levels, + Add document, your needs) · toolbar (count badge, mode, Compact view, **Show** filter) · per-plan counts · one gauge panel · filter bar · In all / In some / Only in one plan · "What if" situations · contact cards · chat drawer on the right · PDF side viewer opening at the cited page.
- **Phone:** sidebar and chat as full-screen panels; 2 plans visible.

## Importance filter ("Show")
- Options: Must know only · Must know + important (default) · Everything.
- A filter bar under the gauges always states what is shown and hidden ("Showing must know only: 6 of 13 benefits. Hidden: 4 important and 3 good to know.") with a "Show everything" button. Changing the filter scrolls to the bar and flashes it once (instant when reduced motion is set).
- The match score always uses every benefit; the filter only changes what is listed.
