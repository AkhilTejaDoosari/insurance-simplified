/**
 * The one adapter that feeds /demo. It returns the owner-approved demo's own data
 * (docs/v2/demo/data.py, as embedded in the BUNDLE of
 * docs/v2/demo/insurance-simplified-v2-demo.html) in exactly the demo's shape:
 * { CAT, DOCS, FACTS, PLANS }. Every plan, value and page in it is invented.
 *
 * The JSON is copied verbatim by `node scripts/extract-demo-bundle.mjs`. The shape
 * is checked once at load, so a broken copy fails loudly instead of rendering
 * wrong values.
 */
import type { EngineValue, V2Document, V2Fact } from "@/app/lib/engine/client";
import raw from "../data/demo-data.json";

/** 1 = Must know, 2 = Important, 3 = Good to know. */
export type DemoTier = 1 | 2 | 3;
/** [tier, display name, general explanation] */
export type DemoCategory = [tier: DemoTier, name: string, explain: string];
/** v = Verified, x = Not covered, u = Couldn't confirm, k = Conflicting. */
export type DemoState = "v" | "x" | "u" | "k";
export type DemoBasis = "" | "year" | "incident" | "visit" | "trip";

export interface DemoFact {
  /** state */
  s: DemoState;
  /** display value */
  d: string;
  /** number used for scoring (0 when none) */
  n: number;
  /** basis of the amount */
  b: DemoBasis;
  /** the document's own wording */
  w: string;
  /** PDF page (1-based, physical) */
  p: number;
  /** plain-words explanation */
  pl: string;
  /** where to look on the page */
  look: string;
  /** Uploaded documents only: the engine's value kind when VERIFIED ("amount", "percent",
   *  ...), else "". Absent in the demo's own data. Scoring compares a number only when
   *  the kind says it is one (see NEED_DEFS). */
  k?: string;
}

/** [kind, value, label, page] */
export type DemoContact = [kind: string, value: string, label: string, page: number];

export interface DemoDoc {
  id: string;
  file: string;
  family: string;
  type: string;
  pages: number;
  /** physical page minus printed page number */
  offset: number;
  levels: string[];
  plans: string[];
  initial: boolean;
  contacts: DemoContact[];
}

/** [docId, level] */
export type DemoPlanRef = [docId: string, level: string];

export interface DemoBundle {
  CAT: Record<string, DemoCategory>;
  DOCS: DemoDoc[];
  FACTS: Record<string, Partial<Record<string, DemoFact>>>;
  PLANS: Record<string, DemoPlanRef>;
}

const STATES = new Set(["v", "x", "u", "k"]);
const BASES = new Set(["", "year", "incident", "visit", "trip"]);

function fail(path: string, what: string): never {
  throw new Error(`demo bundle: ${path} ${what}`);
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, path: string): string => (typeof v === "string" ? v : fail(path, "must be a string"));
const num = (v: unknown, path: string): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fail(path, "must be a number");

/** Checks an unknown value against the demo's shape and returns it typed. */
export function parseDemoBundle(input: unknown): DemoBundle {
  if (!isObj(input)) fail("root", "must be an object");
  const { CAT, DOCS, FACTS, PLANS } = input;

  if (!isObj(CAT)) fail("CAT", "must be an object");
  for (const [k, c] of Object.entries(CAT)) {
    if (!Array.isArray(c) || c.length !== 3 || ![1, 2, 3].includes(c[0] as number))
      fail(`CAT.${k}`, "must be [tier 1-3, name, explanation]");
    str(c[1], `CAT.${k}[1]`);
    str(c[2], `CAT.${k}[2]`);
  }

  if (!Array.isArray(DOCS) || DOCS.length === 0) fail("DOCS", "must be a non-empty array");
  DOCS.forEach((d, i) => {
    const at = `DOCS[${i}]`;
    if (!isObj(d)) fail(at, "must be an object");
    for (const f of ["id", "file", "family", "type"]) str(d[f], `${at}.${f}`);
    num(d.pages, `${at}.pages`);
    num(d.offset, `${at}.offset`);
    if (typeof d.initial !== "boolean") fail(`${at}.initial`, "must be a boolean");
    for (const f of ["levels", "plans"]) {
      const a = d[f];
      if (!Array.isArray(a) || a.length === 0) fail(`${at}.${f}`, "must be a non-empty array");
      a.forEach((x, j) => str(x, `${at}.${f}[${j}]`));
    }
    if (!Array.isArray(d.contacts)) fail(`${at}.contacts`, "must be an array");
    d.contacts.forEach((c, j) => {
      if (!Array.isArray(c) || c.length !== 4) fail(`${at}.contacts[${j}]`, "must be [kind, value, label, page]");
      str(c[0], `${at}.contacts[${j}][0]`);
      str(c[1], `${at}.contacts[${j}][1]`);
      str(c[2], `${at}.contacts[${j}][2]`);
      num(c[3], `${at}.contacts[${j}][3]`);
    });
  });
  const docIds = new Set(DOCS.map((d) => (d as DemoDoc).id));

  if (!isObj(PLANS)) fail("PLANS", "must be an object");
  for (const [id, ref] of Object.entries(PLANS)) {
    if (!Array.isArray(ref) || ref.length !== 2) fail(`PLANS.${id}`, "must be [docId, level]");
    if (!docIds.has(str(ref[0], `PLANS.${id}[0]`))) fail(`PLANS.${id}[0]`, "names an unknown document");
    str(ref[1], `PLANS.${id}[1]`);
  }
  for (const d of DOCS as DemoDoc[])
    for (const p of d.plans) if (!(p in PLANS)) fail(`DOCS.${d.id}.plans`, `names unknown plan ${p}`);

  if (!isObj(FACTS)) fail("FACTS", "must be an object");
  for (const [id, facts] of Object.entries(FACTS)) {
    if (!(id in PLANS)) fail(`FACTS.${id}`, "names an unknown plan");
    if (!isObj(facts)) fail(`FACTS.${id}`, "must be an object");
    for (const [k, f] of Object.entries(facts)) {
      const at = `FACTS.${id}.${k}`;
      if (!(k in CAT)) fail(at, "names an unknown category");
      if (!isObj(f)) fail(at, "must be an object");
      if (!STATES.has(f.s as string)) fail(`${at}.s`, "must be v, x, u or k");
      if (!BASES.has(f.b as string)) fail(`${at}.b`, "has an unknown basis");
      for (const x of ["d", "w", "pl", "look"]) str(f[x], `${at}.${x}`);
      if (f.k !== undefined) str(f.k, `${at}.k`);
      num(f.n, `${at}.n`);
      num(f.p, `${at}.p`);
    }
  }
  for (const id of Object.keys(PLANS)) if (!(id in FACTS)) fail(`FACTS`, `has no entry for plan ${id}`);

  return input as unknown as DemoBundle;
}

let cached: DemoBundle | null = null;

/** The demo's data: { CAT, DOCS, FACTS, PLANS }. */
export function loadDemoBundle(): DemoBundle {
  cached ??= parseDemoBundle(raw);
  return cached;
}

/* ------------------------------------------------------------------ real engine results */


const STATE: Partial<Record<V2Fact["state"], DemoState>> = {
  verified: "v",
  not_covered: "x",
  couldnt_confirm: "u",
  conflicting: "k",
  // not_mentioned is never a cell value: absence is decided below, never "Not covered"
};
const RANK: Record<DemoState, number> = { v: 0, x: 1, k: 2, u: 3 };
const BASIS: Partial<Record<EngineValue["basis"], DemoBasis>> = {
  per_year: "year",
  per_incident: "incident",
  per_visit: "visit",
  per_period_of_coverage: "trip",
};
const BASIS_WORDS: Partial<Record<EngineValue["basis"], string>> = {
  per_year: "per year",
  per_incident: "per illness or injury",
  per_visit: "per visit",
  per_day: "per day",
  per_admission: "per hospital stay",
  per_period_of_coverage: "per trip",
  lifetime: "for life",
};
/** The single plan "level" of an uploaded document until plan levels are read (WP6). */
export const ENGINE_LEVEL = "Plan";

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** d (display) from the engine's code reading of a VERIFIED value - never interpreted here. */
function display(v: EngineValue): string {
  const n = v.number == null ? null : Number(v.number);
  const basis = BASIS_WORDS[v.basis];
  const withBasis = (s: string) => (basis ? `${s} ${basis}` : s);
  switch (v.kind) {
    case "amount":
      return withBasis(n == null ? (v.text ?? "") : money(n));
    case "percent":
      return withBasis(`${n}%`);
    case "count":
      return withBasis(v.text ?? String(n));
    case "duration_days":
      return `${n} days`;
    default:
      return v.text ?? (v.kind === "covered" ? "Covered" : "");
  }
}

function factOf(f: V2Fact, s: DemoState): DemoFact {
  const look = f.column ? `Row ${f.label} · Column ${f.column}` : `Row ${f.label}`;
  if (s === "v" && f.value) {
    return {
      s,
      d: display(f.value),
      n: f.value.number == null ? 0 : Number(f.value.number),
      b: BASIS[f.value.basis] ?? "",
      w: f.quote,
      p: f.page,
      // the engine's one checked line, written only from the printed label and quote
      pl: f.plain,
      look,
      k: f.value.kind,
    };
  }
  return {
    s,
    d: s === "x" ? "Not covered" : `Check page ${f.page}`,
    n: 0,
    b: "",
    w: f.quote,
    p: f.page,
    pl: "",
    look,
    k: "",
  };
}

function family(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : filename;
}

/**
 * The real engine results of the uploaded session as { CAT, DOCS, FACTS, PLANS }, in the
 * demo's exact shape. Each document is one plan until plan levels are read (WP6).
 *
 * - categories: the engine's dictionary (synonym matches only); a fact the engine did not
 *   map - or a second fact in a category this plan already fills - becomes a plan-specific
 *   row in the document's own words (tier 3, no general explanation);
 * - a category another plan states but this one has no fact for: "Couldn't confirm -
 *   check page N" when the engine's wording search found it printed on page N, else
 *   absent ("Not mentioned", wording searched). Never "Not covered".
 */
export function bundleFromEngine(docs: V2Document[]): DemoBundle {
  const dictionary = new Map(
    docs.flatMap((d) => d.categories).map((c) => [c.key, c] as const),
  );
  const facts: Record<string, Partial<Record<string, DemoFact>>> = {};
  const plans: Record<string, DemoPlanRef> = {};
  const own: [string, DemoCategory][] = [];
  const used = new Set<string>();
  for (const doc of docs) {
    const id = doc.documentId;
    plans[id] = [id, ENGINE_LEVEL];
    const mine: Partial<Record<string, DemoFact>> = (facts[id] = {});
    const ranked = doc.facts
      .map((f, i) => ({ f, i, s: STATE[f.state] }))
      .filter((x): x is { f: V2Fact; i: number; s: DemoState } => x.s !== undefined)
      .sort((a, b) => RANK[a.s] - RANK[b.s] || a.i - b.i);
    const extra: { f: V2Fact; s: DemoState; i: number }[] = [];
    for (const x of ranked) {
      const key = x.f.categoryKey;
      if (key && dictionary.has(key) && !mine[key]) {
        mine[key] = factOf(x.f, x.s);
        used.add(key);
      } else extra.push(x);
    }
    for (const { f, s, i } of extra.sort((a, b) => a.i - b.i)) {
      const key = `p:${id}:${i}`;
      own.push([key, [3, f.column ? `${f.label} (${f.column})` : f.label, ""]]);
      mine[key] = factOf(f, s);
    }
  }
  for (const doc of docs) {
    const mine = facts[doc.documentId];
    for (const key of used) {
      const page = doc.categorySearch[key];
      if (mine[key] || page == null) continue;
      mine[key] = { s: "u", d: `Check page ${page}`, n: 0, b: "", w: "", p: page, pl: "", look: "", k: "" };
    }
  }
  const cat: Record<string, DemoCategory> = {};
  for (const c of [...dictionary.values()]
    .filter((c) => used.has(c.key))
    .sort((a, b) => a.tier - b.tier || a.order - b.order))
    cat[c.key] = [c.tier as DemoTier, c.name, c.explain];
  for (const [key, entry] of own) cat[key] = entry;
  return parseDemoBundle({
    CAT: cat,
    DOCS: docs.map((d) => ({
      id: d.documentId,
      file: d.filename,
      family: family(d.filename),
      type: "Uploaded document",
      pages: d.pages,
      offset: 0,
      levels: [ENGINE_LEVEL],
      plans: [d.documentId],
      initial: true,
      contacts: [],
    })),
    FACTS: facts,
    PLANS: plans,
  });
}
