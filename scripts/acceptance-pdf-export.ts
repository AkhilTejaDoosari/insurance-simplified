// Real-PDF acceptance for the P2 PDF export flow.
// Uploads two real insurer PDFs, extracts, exports the persisted validated
// result as PDF, parses it back with unpdf, and asserts on content,
// citations, multi-tier attribution, pagination, and credential hygiene.
//
// Usage: BASE_URL=http://localhost:3334 npx tsx scripts/acceptance-pdf-export.ts

import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const BASE = process.env.BASE_URL ?? "http://localhost:3334";
const WORLTRIPS = "nonstandard/03_worldtrips_studentsecure.pdf";
const SEVEN_CORNERS = "nonstandard/04_seven_corners_travel_medical_usa.pdf";

type Check = { name: string; pass: boolean; detail?: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function cookieHeader(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? [];
  const sid = raw.find((c) => c.startsWith("sid_cap="));
  if (!sid) throw new Error("upload did not set sid_cap cookie");
  return sid.split(";")[0];
}

async function main() {
  const form = new FormData();
  for (const path of [WORLTRIPS, SEVEN_CORNERS]) {
    const bytes = readFileSync(path);
    form.append(
      "documents",
      new File([new Uint8Array(bytes)], path.split("/").pop()!, { type: "application/pdf" }),
    );
  }
  form.append("age", "24");
  form.append("visaOrStatus", "F-1 student");

  const upload = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
  check("upload accepts two real PDFs", upload.status === 201, `status ${upload.status}`);
  if (upload.status !== 201) {
    console.error(await upload.text());
    process.exit(1);
  }
  const cookie = cookieHeader(upload);
  const { sessionId } = (await upload.json()) as { sessionId: string };

  const extract = await fetch(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ sessionId }),
  });
  check("extract returns validated table", extract.status === 200, `status ${extract.status}`);
  const table = (await extract.json()) as {
    rows: {
      factName: string;
      verdict: string;
      values: { display: string; qualifiers: { planTier?: string }; evidence: { page: number }[] }[];
    }[];
    presentationGroups?: { title: string }[];
  };
  if (extract.status !== 200) {
    console.error(JSON.stringify(table).slice(0, 500));
    process.exit(1);
  }

  const unauthExport = await fetch(`${BASE}/api/export?sessionId=${sessionId}`);
  check("export rejects missing capability (401)", unauthExport.status === 401, `status ${unauthExport.status}`);

  const exported = await fetch(`${BASE}/api/export?sessionId=${sessionId}`, { headers: { cookie } });
  check("export returns 200 PDF", exported.status === 200, `status ${exported.status}`);
  check(
    "content-type is application/pdf",
    exported.headers.get("content-type") === "application/pdf",
    exported.headers.get("content-type") ?? "none",
  );
  const pdfBytes = new Uint8Array(await exported.arrayBuffer());
  check("PDF magic bytes", Buffer.from(pdfBytes).subarray(0, 5).toString("latin1") === "%PDF-");

  const proxy = await getDocumentProxy(pdfBytes);
  const extracted = await extractText(proxy, { mergePages: false });
  const pageTexts = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const text = pageTexts.join(" ");

  check("exported PDF paginates (>=2 pages)", pageTexts.length >= 2, `${pageTexts.length} pages`);
  check("pagination footer present", /\d+ \/ \d+/.test(text));

  const deductibleRow = table.rows.find((r) => r.factName === "annual-deductible");
  const tiers = (deductibleRow?.values ?? [])
    .map((v) => v.qualifiers.planTier)
    .filter((t): t is string => Boolean(t));
  check("extract found multi-tier deductibles", tiers.length >= 2, `${tiers.length} tiers: ${tiers.join(", ")}`);
  for (const tier of tiers) {
    check(`PDF attributes tier "${tier}"`, text.includes(tier));
  }
  const dollarZero = (text.match(/\$0\b/g) ?? []).length;
  check("PDF contains $0 deductible values", dollarZero >= 2, `${dollarZero} occurrences`);

  const citePages = (deductibleRow?.values ?? [])
    .flatMap((v) => v.evidence.map((e) => e.page));
  const uniqueCitePages = [...new Set(citePages)];
  check("extract cited deductible pages", uniqueCitePages.length >= 1, `pages ${uniqueCitePages.join(", ")}`);
  for (const page of uniqueCitePages) {
    check(`PDF cites deductible page ${page}`, text.includes(`page ${page}`));
  }

  check("PDF names WorldTrips document", text.includes("03_worldtrips_studentsecure.pdf"));
  check("PDF names Seven Corners document", text.includes("04_seven_corners_travel_medical_usa.pdf"));
  check("PDF includes supplied context (F-1)", /F-1/.test(text));
  check("PDF leaks no session id", !text.includes("sess-"));
  check("PDF leaks no capability cookie value", !text.includes("sid_cap"));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exit(1);
  }
  console.log("REAL-PDF ACCEPTANCE: PASS");
}

main().catch((err) => {
  console.error("acceptance script crashed:", err);
  process.exit(1);
});
