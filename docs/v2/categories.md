# Categories, importance tiers and cutoff (copied from the owner's planning documents)

> Copied 2026-11-27 from the claude.ai project ("2026-11-26-dynamic-categories-decision.md") so
> coding agents can read it. **Precedence:** `docs/v2/scope.md` wins where this file mentions
> expected lists, "Not stated" rows or Tier 1 rows always shown — in V2 the dictionary only
> matches wording and orders rows; it never expects content.

## 1. Discover, don't look up
Extraction finds every benefit the document states, in the document's own words ("Emergency Room – Illness", "Accident & Sickness ER", "Office Visit – PCP"), each with value, qualifiers, semantic fields and evidence span. Nothing is searched for from a fixed list first, so different wording can't cause "not stated".

## 2. Map to an open taxonomy (mapping is a claim, so it is verified)
- **Taxonomy** per market pack: hierarchical (e.g. ER → ER illness, ER accident), each category with synonyms, a tier, and a default weight. It is open: it grows.
- Each discovered benefit gets a proposed category with a confidence, from the synonym list first, then the extraction model's proposal.
- **The mapping is verified like a value:** accepted only if the document's label matches a synonym, or the independent judge confirms "this label means this category" at confidence ≥ the mapping cutoff (owner-set; start 0.9).
- **Below the cutoff or no match** → kept as a **plan-specific row** in the document's own wording ("Only in one plan" / "Other benefits in this plan"), still verified. Never forced into a category, never dropped.
- Different granularity (one plan states ER illness/accident separately, another states one ER value) → compared at the parent category, with a note; detail kept underneath.
- **Learning loop:** unmapped labels (labels only, no document text) are logged; the owner reviews and adds synonyms/categories. Human-reviewed growth, no silent self-learning.

## 3. Four answers, never confused
For each category × plan: **Verified value** · **Not covered** (the document explicitly excludes it — a verified negation) · **Not stated** (the document is silent — not the same as excluded) · **Couldn't confirm**. Plus **Conflicting** when the document gives two values.

## 4. Importance tiers and weights (display order)
- **Tier 1 — Must know:** deductible, most you'll pay in a year (out-of-pocket max), ER, hospital stay, pre-existing conditions, overall plan maximum, network/geography limits, premium if stated.
- **Tier 2 — Important:** doctor visit, specialist, urgent care, prescriptions, mental health, maternity, medical evacuation, repatriation.
- **Tier 3 — Good to know:** dental, vision, chiropractic, physical therapy, wellness, other.
- **Tier 4 — Admin:** contacts, claims process, definitions (shown in their own section).
- Order within a view: tier first; inside a tier, by **row weight = taxonomy weight × user-need boost (row is one of the user's must-haves) × difference boost (plans disagree, in compare mode)**.
- Tiers and weights live in the market pack; defaults are owner-reviewed, not AI-decided.

## 5. Cutoff (what is shown by default)
- Default view shows Tier 1 and Tier 2; lower tiers collapsed as "N more categories" — user can change the cutoff.
- Tier 2+ rows that are Not stated in **every** selected plan collapse into one line: "Not mentioned in any of these documents: …".
- Plan-specific rows always shown in their own section (nothing a plan offers is hidden by the taxonomy).

## 6. Relation to the match score
Same taxonomy. The match score's needs are categories; the user's must-haves boost their rows to the top of their tier. Display weight (importance) and score weight (user needs) are separate numbers; neither is set by the AI.

## 7. Tests
- Mapping precision: wrong category mappings ÷ accepted mappings = 0 on the validation and blind sets (answer key records the correct category for each benefit label).
- Silent benefit loss: benefits stated in the document but absent from both mapped and plan-specific rows = 0.
- Excluded vs not stated: explicit exclusions shown as "Not covered", silence as "Not stated" — 0 confusions.
