/**
 * Pure logic of the /demo screens, ported 1:1 from the owner-approved demo
 * (docs/v2/demo/template.html). Nothing here touches the DOM, so it is unit-tested.
 */
import type { DemoBasis, DemoBundle, DemoFact, DemoState, DemoTier } from "./demo-adapter";

export const BL: Record<string, string> = {
  year: "per year",
  incident: "per illness or injury",
  visit: "per visit",
  trip: "per trip",
};
export const LB: Record<DemoState, string> = {
  v: "Verified",
  x: "Not covered",
  u: "Couldn't confirm",
  k: "Conflicting",
};
export const GN: Record<DemoTier, string> = { 1: "Must know", 2: "Important", 3: "Good to know" };
export const CUTN: Record<DemoTier, string> = {
  1: "Must know only",
  2: "Must know + important",
  3: "Everything",
};
export const TIERS: DemoTier[] = [1, 2, 3];
export const MAX_DOCS = 5;

export const money = (n: number): string => "$" + Math.round(n).toLocaleString("en-US");

/* ---------- needs ---------- */

export interface NeedDef {
  k: string;
  l: string;
  b?: DemoBasis;
  /** true met, false missed, null: the value can't be compared (scored as not met). */
  test: (c: DemoFact, threshold: number | null) => boolean | null;
}
export interface NeedState {
  on: boolean;
  must: boolean;
  th: number | null;
}
/** An uploaded document's value is compared as a number only when the engine read it as
 *  an amount (the demo's own data has no kind: compared as the demo does). */
const amount = (c: DemoFact) => c.k === undefined || c.k === "amount";
export const NEED_DEFS: NeedDef[] = [
  { k: "oop", l: "Yearly max at most", b: "year", test: (c, t) => (amount(c) ? c.n <= (t ?? 0) : null) },
  // "no per-visit cap" is not something one printed value can prove: uploaded documents
  // are never scored as meeting it from the value alone
  { k: "er", l: "ER with no per-visit cap", test: (c) => (c.k === undefined ? c.n == 1 : null) },
  { k: "pre", l: "Condition I had before covered", test: (c) => c.s == "v" },
  { k: "ded", l: "Deductible per year at most", b: "year", test: (c, t) => (amount(c) ? c.n <= (t ?? 0) : null) },
  { k: "evac", l: "Evacuation at least", test: (c, t) => (amount(c) ? c.n >= (t ?? 0) : null) },
];
export const initialNeeds = (): NeedState[] => [
  { on: true, must: true, th: 5000 },
  { on: true, must: true, th: null },
  { on: true, must: true, th: null },
  { on: true, must: false, th: 500 },
  { on: true, must: false, th: 100000 },
];

/* ---------- the model ---------- */

export type BreakdownMark = "met" | "missed" | "unknown" | "basis";
export interface BreakdownLine {
  mark: BreakdownMark;
  text: string;
}
export interface Score {
  p: number;
  unk: number;
  miss: string[];
  li: BreakdownLine[];
}
export interface FamilyGroup {
  f: string;
  ids: string[];
}
export interface WhatIfRow {
  id: string;
  fact: DemoFact | undefined;
  how: string;
  amount: number;
}
export interface ContactCard {
  docId: string;
  family: string;
  contacts: { label: string; value: string; kind: string; page: number }[];
  questions: string[];
  email: string | null;
  questionsHref: string | null;
  requestHref: string | null;
}
export interface FilterSummary {
  cutLabel: string;
  shown: number;
  total: number;
  hidden: string;
}
export interface ComparisonSections {
  all: string[];
  some: string[];
  one: string[];
}
export interface ReadingStats {
  n: number;
  u: number;
  k: number;
}

export function demoModel(B: DemoBundle) {
  const { CAT, DOCS, FACTS, PLANS } = B;
  const KEYS = Object.keys(CAT);
  const tier = (k: string): DemoTier => CAT[k][0];
  const docById = (id: string) => {
    const d = DOCS.find((x) => x.id == id);
    if (!d) throw new Error(`unknown demo document ${id}`);
    return d;
  };
  const docOf = (id: string) => docById(PLANS[id][0]);
  const nm = (id: string) => docOf(id).family + " " + PLANS[id][1];
  const lv = (id: string) => PLANS[id][1];
  const F = (id: string, k: string): DemoFact | undefined => FACTS[id]?.[k];
  const printed = (id: string, p: number): number | null => {
    const d = docOf(id);
    return p > d.offset ? p - d.offset : null;
  };
  const pageLabel = (id: string, p: number) => {
    const pp = printed(id, p);
    return "Page " + p + (pp && pp != p ? " (printed " + pp + ")" : "");
  };
  const loadedPlans = (order: string[], loaded: string[]) => order.filter((id) => loaded.includes(PLANS[id][0]));
  const selectedPlans = (order: string[], loaded: string[], sel: ReadonlySet<string>) =>
    loadedPlans(order, loaded).filter((id) => sel.has(id));
  const mentioned = (k: string, ids: string[]) => ids.filter((i) => F(i, k));

  function score(id: string, ids: string[], needs: NeedState[]): Score {
    let tot = 0;
    let got = 0;
    const unk: string[] = [];
    const miss: string[] = [];
    const li: BreakdownLine[] = [];
    NEED_DEFS.forEach((nd, i) => {
      const st = needs[i];
      if (!st.on || !mentioned(nd.k, ids).length) return;
      const c = F(id, nd.k);
      const w = st.must ? 3 : 1;
      const lab = nd.l + (st.th != null ? " " + money(st.th) : "");
      if (!c) {
        tot += w;
        unk.push(lab);
        li.push({ mark: "unknown", text: lab + " — not mentioned" });
        return;
      }
      if (c.s == "u" || c.s == "k") {
        tot += w;
        unk.push(lab);
        li.push({ mark: "unknown", text: lab + " — " + LB[c.s] });
        return;
      }
      if (nd.b && c.b && c.b != nd.b) {
        li.push({ mark: "basis", text: lab + " — different basis (" + BL[c.b] + "), not scored" });
        return;
      }
      tot += w;
      const met = nd.test(c, st.th);
      if (met === null) {
        unk.push(lab);
        li.push({ mark: "unknown", text: lab + " — can't be compared from its wording (" + c.d + ")" });
        return;
      }
      if (met) {
        got += w;
        li.push({ mark: "met", text: lab + " — " + c.d });
      } else {
        li.push({ mark: "missed", text: lab + " — " + c.d });
        if (st.must) miss.push(nd.l);
      }
    });
    return { p: tot ? Math.round((got / tot) * 100) : 0, unk: unk.length, miss, li };
  }

  /** green ≥ 80% and no missed must-have; amber 50–79%; red below 50% or any missed must-have. */
  const gaugeTone = (s: Score): "signal" | "amber" | "leaf" =>
    s.miss.length || s.p < 50 ? "signal" : s.p < 80 ? "amber" : "leaf";

  /** Needs that no selected document mentions: shown as "Not scored". */
  const unscoredNeeds = (ids: string[], needs: NeedState[]) =>
    NEED_DEFS.filter((nd, i) => needs[i].on && !mentioned(nd.k, ids).length).map((nd) => nd.l.toLowerCase());

  function rowMarks(k: string, ids: string[]) {
    const cs = ids.map((i) => F(i, k)).filter((c): c is DemoFact => Boolean(c));
    const bs = new Set(cs.filter((c) => c.b).map((c) => c.b));
    const dif = new Set(cs.map((c) => c.s + c.d)).size > 1 || cs.length < ids.length;
    return { differentBasis: bs.size > 1, differs: dif };
  }

  function famGroups(ids: string[]): FamilyGroup[] {
    const g: FamilyGroup[] = [];
    ids.forEach((id) => {
      const f = docOf(id).family;
      if (!g.length || g[g.length - 1].f != f) g.push({ f, ids: [] });
      g[g.length - 1].ids.push(id);
    });
    return g;
  }

  /** Number of levels when every level of the family states the same thing, else 0. */
  function sameForAllLevels(group: FamilyGroup, k: string): number {
    const all = docOf(group.ids[0]).plans;
    const eq =
      all.length > 1 &&
      all.every((i) => F(i, k)) &&
      new Set(all.map((i) => (F(i, k) as DemoFact).s + (F(i, k) as DemoFact).d)).size == 1;
    return eq && group.ids.length > 1 ? all.length : 0;
  }

  /** Plan columns that fit: main area width → 1..5 (phone: 2). */
  const capacity = (w: number) => (w < 700 ? (w < 340 ? 1 : 2) : Math.max(1, Math.min(5, Math.floor((w - 230) / 175))));

  function counts(i: string, ids: string[]) {
    const n = KEYS.filter((k) => F(i, k)).length;
    const a = KEYS.filter((k) => F(i, k) && mentioned(k, ids).length == ids.length).length;
    const o = KEYS.filter((k) => F(i, k) && mentioned(k, ids).length == 1).length;
    return { n, a, some: n - a - o, o };
  }

  function filterSummary(ids: string[], cut: DemoTier): FilterSummary {
    const allK = KEYS.filter((k) => mentioned(k, ids).length);
    const shown = allK.filter((k) => tier(k) <= cut);
    const hidK = allK.filter((k) => tier(k) > cut);
    const hg = ([2, 3] as DemoTier[])
      .filter((g) => g > cut)
      .map((g) => `${allK.filter((k) => tier(k) == g).length} ${GN[g].toLowerCase()}`)
      .join(" and ");
    return { cutLabel: CUTN[cut].toLowerCase(), shown: shown.length, total: allK.length, hidden: hidK.length ? hg : "" };
  }

  function sections(ids: string[], cut: DemoTier): ComparisonSections {
    const all: string[] = [];
    const some: string[] = [];
    const one: string[] = [];
    KEYS.forEach((k) => {
      const n = mentioned(k, ids).length;
      if (!n || tier(k) > cut) return;
      if (n == ids.length) all.push(k);
      else if (n >= 2) some.push(k);
      else one.push(k);
    });
    return { all, some, one };
  }

  const singlePlanKeys = (id: string, cut: DemoTier) => KEYS.filter((k) => F(id, k) && tier(k) <= cut);

  function whatIf(ids: string[]): WhatIfRow[] {
    return ids.map((id) => {
      const c = F(id, "ded");
      if (!c) return { id, fact: undefined, how: "Deductible not mentioned", amount: 0 };
      const t = c.b == "incident" ? 2 : 1;
      const how =
        c.b == "incident"
          ? "$" + c.n + " for each illness, so twice"
          : c.b == "trip"
            ? "Once for the whole trip"
            : c.n
              ? "Once for the whole year"
              : "No deductible";
      return { id, fact: c, how, amount: c.n * t };
    });
  }

  function contactCards(ids: string[]): ContactCard[] {
    const fs = [...new Set(ids.map((i) => docOf(i).id))];
    return fs.map((did) => {
      const d = docById(did);
      const mine = ids.filter((i) => docOf(i).id == did);
      const qs: string[] = [];
      mine.forEach((i) =>
        KEYS.forEach((k) => {
          const c = F(i, k);
          if (!c && mentioned(k, ids).length)
            qs.push(`- ${CAT[k][1]} (${lv(i)}): your document does not mention this. Is it covered?`);
          else if (c && c.s == "u") qs.push(`- ${CAT[k][1]}: I could not confirm the amount on page ${c.p}. What is it?`);
          else if (c && c.s == "k")
            qs.push(`- ${CAT[k][1]}: the document gives two different values (${c.d}). Which is correct?`);
        }),
      );
      const em = d.contacts.find((c) => c[0] == "Email");
      const body = `Hello,\n\nI have questions about ${d.family} (${mine.map(lv).join(", ")}). My member number: ____\n\n${qs.slice(0, 8).join("\n")}\n\nThank you.`;
      const req = `Hello,\n\nPlease send me the Summary of Benefits and Coverage (or the full written plan terms) for ${d.family}.\n\nThank you.`;
      return {
        docId: did,
        family: d.family,
        contacts: d.contacts.map((c) => ({ kind: c[0], value: c[1], label: c[2], page: c[3] })),
        questions: qs,
        email: em ? em[1] : null,
        questionsHref: em
          ? `mailto:${em[1]}?subject=${encodeURIComponent("Question about " + d.family)}&body=${encodeURIComponent(body)}`
          : null,
        requestHref: em
          ? `mailto:${em[1]}?subject=${encodeURIComponent("Request for plan documents")}&body=${encodeURIComponent(req)}`
          : null,
      };
    });
  }

  function readingStats(docId: string): ReadingStats {
    const d = docById(docId);
    const keys = new Set<string>();
    const u = new Set<string>();
    const k = new Set<string>();
    d.plans.forEach((p) =>
      Object.entries(FACTS[p]).forEach(([c, f]) => {
        keys.add(c);
        if (f?.s == "u") u.add(c);
        if (f?.s == "k") k.add(c);
      }),
    );
    return { n: keys.size, u: u.size, k: k.size };
  }

  /** Swap a plan with its neighbour (-1 left, +1 right) among the selected plans. */
  function movePlan(order: string[], selected: string[], id: string, dir: -1 | 1): string[] {
    const o = selected[selected.indexOf(id) + dir];
    if (!o) return order;
    const next = [...order];
    const i1 = next.indexOf(id);
    const i2 = next.indexOf(o);
    next[i1] = o;
    next[i2] = id;
    return next;
  }

  return {
    CAT,
    DOCS,
    FACTS,
    PLANS,
    KEYS,
    tier,
    docById,
    docOf,
    nm,
    lv,
    F,
    printed,
    pageLabel,
    loadedPlans,
    selectedPlans,
    mentioned,
    score,
    gaugeTone,
    unscoredNeeds,
    rowMarks,
    famGroups,
    sameForAllLevels,
    capacity,
    counts,
    filterSummary,
    sections,
    singlePlanKeys,
    whatIf,
    contactCards,
    readingStats,
    movePlan,
  };
}

export type DemoModel = ReturnType<typeof demoModel>;

/** Reading screen stages (one bar segment each). */
export const READING_STAGES = ["Uploaded", "Reading pages and tables", "Finding values", "Verifying (two keys)", "Done"];
