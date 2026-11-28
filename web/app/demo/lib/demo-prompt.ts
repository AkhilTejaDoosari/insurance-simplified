/**
 * "Find your plan documents": where documents usually are, and the prompt for the
 * user's own AI (docs/v2/demo/template.html "find"). Pure, so it is unit-tested.
 */
export type Country = "US" | "IN";

export interface CountryOptions {
  loc: string;
  ph: [city: string, code: string];
  how: string[];
  ex: string;
  src: string;
  doc: string;
}

export const OPT: Record<Country, CountryOptions> = {
  US: {
    loc: "ZIP code",
    ph: ["Texas, Denton", "76201"],
    how: [
      "Through my employer",
      "Buying on my own (marketplace)",
      "Through my school",
      "Medicaid or a government program",
      "Travel or visitor coverage",
    ],
    ex: "low yearly maximum, covers a condition I already have, mental health, prescriptions",
    src: "insurers' own websites, HealthCare.gov or my state marketplace, or my school's website",
    doc: "benefits summary (SBC), brochure, or policy document",
  },
  IN: {
    loc: "PIN code",
    ph: ["Telangana, Hyderabad", "500081"],
    how: [
      "Through my employer (group policy)",
      "Buying on my own (individual or family floater)",
      "Government scheme",
      "Travel coverage",
    ],
    ex: "sum insured of at least ₹10 lakh, no room-rent limit, short waiting period for a condition I already have, cashless hospitals near me",
    src: "websites of insurers registered with IRDAI",
    doc: "policy wording, Customer Information Sheet, or brochure",
  },
};

export const WHO = (country: Country) => [
  "Just me",
  "Me and my spouse",
  "My family" + (country == "IN" ? " (family floater)" : ""),
  "A visiting parent",
];
export const REQUIREMENTS = ["None", "My school's rules", "My visa's rules", "My employer's rules"];

export const WHERE: [string, string][] = [
  ["Insurance through work", 'HR or benefits portal. Ask for the "Summary of Benefits and Coverage"; plans must provide one.'],
  ["Marketplace plan", "HealthCare.gov or your state marketplace. Each plan links its summary."],
  ["Student plan", "Your school's student health insurance page or international office."],
  ["Travel or visitor plan", 'The insurer\'s site, under "plan documents" or "brochure".'],
  ["Already insured", 'Your member portal or app: look for "benefits summary" or "policy document".'],
  ["Only a web page", "In your browser, choose Print, then Save as PDF, and upload it."],
  [
    "Only by phone",
    "Ask them to email the written terms. Good questions: what's the deductible, and is it per year or per illness? What's the most I'd pay in a year? What does an ER visit cost? Are conditions I already have covered?",
  ],
];

export interface PromptInput {
  country: Country;
  city: string;
  code: string;
  age: string;
  who: string;
  how: string;
  requirement: string;
  matters: string;
}

export type PromptResult = { ok: true; prompt: string } | { ok: false; error: string };

export function buildPrompt(i: PromptInput): PromptResult {
  const o = OPT[i.country];
  const c = i.city.trim();
  const z = i.code.trim();
  const a = i.age.trim();
  if (!c || !a) return { ok: false, error: "Enter your state and city, and your age." };
  if (+a < 0 || +a > 120) return { ok: false, error: "Enter an age between 0 and 120." };
  const r = i.requirement;
  const prompt = `I need help finding official health insurance plan documents. Please search the web.\n\nAbout me:\n- Location: ${i.country == "US" ? "United States" : "India"}, ${c}${z ? ", " + o.loc + " " + z : ""}\n- Age: ${a}; cover: ${i.who}\n- How I'll get coverage: ${i.how}${r != "None" ? "\n- It must meet: " + r : ""}\n- What matters to me: ${i.matters.trim() || o.ex}\n\nPlease:\n1. Find 3-6 plans that could fit me, using only ${o.src}. No comparison or lead sites that collect my contact details.\n2. For each plan give: insurer, plan name, plan year, document type (${o.doc}), and a DIRECT link to the official PDF.\n3. Only include links you actually opened during this search. If you could not open one, or found only a web page, say so.\n4. If you cannot browse the web, tell me instead of guessing links.\n5. Do not rank or recommend. Just list what you found and today's date.`;
  return { ok: true, prompt };
}
