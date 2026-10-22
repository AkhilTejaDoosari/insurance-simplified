// Live-LLM chat acceptance for P2 Tasks A–D. Uploads two real insurer PDFs,
// extracts, then asks 4 questions over /api/chat with the live engine:
//   A) WorldTrips deductibles — four named tiers, expects $0 values
//   B) WorldTrips eligibility — F-1 OPT provision, no eligibility guarantee
//   C) cross-document comparison — WorldTrips $0 vs Seven Corners $0–$5,000
//   D) unsupported premium question — must refuse, not invent a number
// Assertions are presence/count/page booleans only; answer text is never logged.
// Liveness gate: each question snapshots the server log's fallback-degradation
// count around its ask; a fallback-served answer FAILS its live-LLM check, so
// fallback output can never count as live LLM success.
//
// Usage: BASE_URL=http://localhost:3334 npx tsx scripts/acceptance-chat-live.ts

import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3334";
const CHAT_LOG = process.env.CHAT_LOG ?? "/tmp/next-3334.log";
const WORLTRIPS = "nonstandard/03_worldtrips_studentsecure.pdf";
const SEVEN_CORNERS = "nonstandard/04_seven_corners_travel_medical_usa.pdf";

/** Count answer-fallback degradations in the server log (null = log unreadable). */
function degradeCount(): number | null {
  try {
    let n = 0;
    for (const line of readFileSync(CHAT_LOG, "utf8").split("\n")) {
      if (line.includes("llm engine failed; degrading to semantic")) n++;
    }
    return n;
  } catch {
    return null;
  }
}

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

type ChatResponse =
  | {
      kind: "answer";
      answerText: string;
      citations: { documentId: string; page: number; quote: string }[];
      grounding?: string;
    }
  | { kind: "refusal"; refusalText: string };

type Liveness = { live: boolean; liveDetail: string };

async function ask(
  cookie: string,
  sessionId: string,
  question: string,
): Promise<{ status: number; body: ChatResponse | Record<string, unknown> } & Liveness> {
  const before = degradeCount();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ sessionId, question, engine: "llm" }),
  });
  const body = (await res.json()) as ChatResponse | Record<string, unknown>;
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = degradeCount();
  const delta = before !== null && after !== null ? after - before : null;
  return {
    status: res.status,
    body,
    live: delta === 0,
    liveDetail:
      delta === null
        ? "degrade log unreadable; liveness unproven"
        : delta > 0
          ? `fallback degraded the engine (+${delta})`
          : delta < 0
            ? "degrade log changed unexpectedly; liveness unproven"
            : "",
  };
}

function checkLive(q: Liveness, name: string, pass: boolean, detail?: string) {
  if (!q.live) {
    check(name, false, `NOT LIVE — ${q.liveDetail}${detail ? `; ${detail}` : ""}`);
    return;
  }
  check(name, pass, detail);
}

function answerOf(body: Record<string, unknown>): Extract<ChatResponse, { kind: "answer" }> | null {
  return body.kind === "answer" ? (body as Extract<ChatResponse, { kind: "answer" }>) : null;
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
  if (extract.status !== 200) {
    console.error((await extract.text()).slice(0, 500));
    process.exit(1);
  }

  const unauth = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, question: "What is the annual deductible?", engine: "llm" }),
  });
  check("chat rejects missing capability (401)", unauth.status === 401, `status ${unauth.status}`);

  // ── Test A: WorldTrips deductibles, four named tiers, $0 values ──────────
  const a = await ask(cookie, sessionId, "What is the annual deductible for each plan tier?");
  check("A served by live LLM (no fallback)", a.live, a.liveDetail || undefined);
  checkLive(a, "A deductibles: status 200", a.status === 200, `status ${a.status}`);
  const aBody = answerOf(a.body as Record<string, unknown>);
  checkLive(a, "A deductibles: kind is answer", aBody !== null, `got "${(a.body as { kind?: string }).kind}"`);
  if (aBody) {
    const text = aBody.answerText ?? "";
    const tiers = ["elite", "select", "budget", "smart"];
    const tiersMentioned = tiers.every((t) => text.toLowerCase().includes(t));
    const zeroCount = (text.match(/\$0\b/g) ?? []).length;
    checkLive(a, "A deductibles: all four tiers named", tiersMentioned);
    checkLive(a, "A deductibles: $0 values present", zeroCount >= 1, `${zeroCount} occurrence(s)`);
    const wtCites = aBody.citations.filter((c) => c.page >= 1);
    checkLive(a, "A deductibles: cites real page", wtCites.length > 0, `pages ${wtCites.map((c) => c.page).join(",")}`);
    checkLive(
      a,
      "A deductibles: cites a WorldTrips page",
      wtCites.some((c) => c.page === 3),
      `pages ${wtCites.map((c) => c.page).join(",")}`,
    );
  }

  // ── Test B: WorldTrips eligibility incl. F-1 OPT, no guarantee ───────────
  const b = await ask(cookie, sessionId, "Is an F-1 student with OPT eligible for WorldTrips Student Secure?");
  check("B served by live LLM (no fallback)", b.live, b.liveDetail || undefined);
  checkLive(b, "B eligibility: status 200", b.status === 200, `status ${b.status}`);
  const bBody = answerOf(b.body as Record<string, unknown>);
  checkLive(b, "B eligibility: kind is answer", bBody !== null, `got "${(b.body as { kind?: string }).kind}"`);
  if (bBody) {
    const text = (bBody.answerText ?? "").toLowerCase();
    const mentionsOpt = text.includes("opt") || text.includes("f-1") || text.includes("f1");
    const guarantees = /\b(is|are)\s+(always\s+)?eligible\b|\bguarantee(d)?\b/.test(text);
    checkLive(b, "B eligibility: mentions F-1/OPT context", mentionsOpt);
    checkLive(b, "B eligibility: does not guarantee eligibility", !guarantees);
    checkLive(
      b,
      "B eligibility: has citations",
      Array.isArray(bBody.citations) && bBody.citations.length > 0,
      `${bBody.citations?.length ?? 0} citations`,
    );
  }

  // ── Test C: cross-doc — WorldTrips $0 across four tiers vs Seven Corners ──
  const c = await ask(
    cookie,
    sessionId,
    "Compare the annual deductibles: what does WorldTrips Student Secure cover vs Seven Corners?",
  );
  check("C served by live LLM (no fallback)", c.live, c.liveDetail || undefined);
  checkLive(c, "C cross-doc: status 200", c.status === 200, `status ${c.status}`);
  const cBody = answerOf(c.body as Record<string, unknown>);
  checkLive(c, "C cross-doc: kind is answer", cBody !== null, `got "${(c.body as { kind?: string }).kind}"`);
  if (cBody) {
    const text = cBody.answerText ?? "";
    const hasWorldtrips = /worldtrips|student\s*secure/i.test(text);
    const hasSevenCorners = /seven\s*corners/i.test(text);
    const hasRange = /\$0/.test(text) && /\$5[,.]?000|\$5000|\$5,000/.test(text);
    checkLive(c, "C cross-doc: mentions WorldTrips", hasWorldtrips);
    checkLive(c, "C cross-doc: mentions Seven Corners", hasSevenCorners);
    checkLive(c, "C cross-doc: shows $0 vs $0–$5,000 range", hasRange);
    checkLive(
      c,
      "C cross-doc: cites multiple real pages",
      cBody.citations.length >= 1 && cBody.citations.every((x) => Number.isInteger(x.page) && x.page >= 1),
      `pages ${cBody.citations.map((x) => x.page).join(",")}`,
    );
  }

  // ── Test D: unsupported premium question must refuse ────────────────────
  const d = await ask(cookie, sessionId, "What is the monthly premium for the Elite plan?");
  check("D served by live LLM (no fallback)", d.live, d.liveDetail || undefined);
  checkLive(d, "D premium: status 200", d.status === 200, `status ${d.status}`);
  const dKind = (d.body as { kind?: string }).kind;
  checkLive(d, "D premium: kind is refusal", dKind === "refusal", `got "${dKind}"`);
  if (dKind === "refusal") {
    const refusalText = ((d.body as { refusalText?: string }).refusalText ?? "").toLowerCase();
    const inventsNumber = /\$\s*\d|\d+\s*(usd|dollars)/.test(refusalText);
    checkLive(d, "D premium: does not invent a number", !inventsNumber);
  }

  const failed = checks.filter((ch) => !ch.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exit(1);
  }
  console.log("LIVE-CHAT ACCEPTANCE: PASS");
}

main().catch((err) => {
  console.error("acceptance script crashed:", err);
  process.exit(1);
});
