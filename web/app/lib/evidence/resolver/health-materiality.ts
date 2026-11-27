// Health-insurance materiality map — ADAPTER DATA for the exclusion
// applicability resolver (evidence-core.md §4: domain-specific parts stay
// outside the core). Versioned: every issued resolution records the version.
//
// OWNER-REVIEWABLE DEFAULTS (M7, agent D). These lists only decide whether an
// exclusion NAMES a service, is circumstantial, or carries a carve-out or an
// express override. They can never make a conclusion more favourable than the
// evidence: anything they do not classify falls through to
// `unresolved_material` (fail closed). Widening or narrowing them is a rule
// change for the owner; bump `version` on every edit.

import type { MaterialityMap } from "@/app/lib/evidence/resolver/materiality";

export const HEALTH_MATERIALITY_MAP_V1: MaterialityMap = Object.freeze({
  version: "health-materiality@1",
  concepts: Object.freeze([
    { id: "acupuncture", terms: ["acupuncture"] },
    { id: "chiropractic-care", terms: ["chiropractic", "chiropractor", "spinal manipulation"] },
    { id: "cosmetic-surgery", terms: ["cosmetic surgery", "cosmetic procedures", "cosmetic services"] },
    { id: "reconstructive-surgery", terms: ["reconstructive surgery"] },
    { id: "bariatric-surgery", terms: ["bariatric surgery", "weight loss surgery"] },
    // Generic: shadowed inside any more specific "<x> surgery" term above.
    { id: "surgery", terms: ["surgery", "surgical services"] },
    { id: "infertility-treatment", terms: ["infertility", "fertility treatment", "in vitro fertilization"] },
    { id: "weight-loss-programs", terms: ["weight loss programs", "weight reduction programs"] },
    { id: "routine-dental", terms: ["dental care", "dental services", "routine dental"] },
    { id: "orthodontics", terms: ["orthodontic", "orthodontics"] },
    { id: "routine-vision", terms: ["eyeglasses", "contact lenses", "routine eye exam", "vision care"] },
    { id: "hearing-aids", terms: ["hearing aids", "hearing aid"] },
    { id: "long-term-care", terms: ["long-term care", "custodial care"] },
    { id: "experimental-treatment", terms: ["experimental", "investigational"] },
    { id: "private-duty-nursing", terms: ["private duty nursing"] },
  ]),
  carveOutMarkers: Object.freeze(["except", "unless", "other than", "with the exception of"]),
  circumstantialMarkers: Object.freeze([
    "if", "when", "only", "while", "after", "before", "during",
    "primarily", "solely", "purpose", "purposes", "medically necessary",
    "in excess of", "more than", "beyond", "limited to", "maximum",
  ]),
  expressOverrideMarkers: Object.freeze(["this exclusion does not apply to", "does not apply to"]),
});
