import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/** /: the V2 screens on the user's own uploaded documents. Upload and extract are mocked
 *  here (deterministic, no storage, no model); the real run with documents is a separate,
 *  owner-run measurement. */

const CATS = [
  { key: "ded", name: "Deductible", tier: 1, order: 1, explain: "The amount you pay yourself before the plan starts paying its share." },
  { key: "oop", name: "Most you pay in a year", tier: 1, order: 2, explain: "The out-of-pocket maximum." },
  { key: "er", name: "ER visit", tier: 1, order: 3, explain: "Emergency room care." },
  { key: "coins", name: "Coinsurance", tier: 1, order: 4, explain: "You split each bill." },
];
const f = (id: string, label: string, quote: string, page: number, categoryKey: string | null, column = "") => ({
  id,
  label,
  column,
  state: "couldnt_confirm",
  quote,
  page,
  categoryKey,
  value: null,
});
const DOCS = [
  {
    documentId: "d1",
    filename: "alpha-student-plan.pdf",
    pages: 3,
    facts: [
      f("a1", "Deductible", "$250 per Policy Year", 1, "ded"),
      f("a2", "Coinsurance", "80% after Deductible", 1, "coins"),
      f("a3", "Emergency Room", "$150 copay per visit", 2, "er"),
      f("a4", "Surgeon's benefit", "$1,000 per surgery", 2, null),
    ],
    openItems: [],
    categories: CATS,
    categorySearch: { oop: null },
  },
  {
    documentId: "d2",
    filename: "beta-travel-plan.pdf",
    pages: 2,
    facts: [
      f("b1", "Deductible", "$100 per Period of Coverage", 1, "ded"),
      f("b2", "Emergency Room", "100% after Deductible", 1, "er"),
    ],
    openItems: [],
    categories: CATS,
    categorySearch: { coins: 2, oop: null },
  },
];
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

async function mock(page: Page, extract: { status: number; body: unknown }) {
  const bodies: unknown[] = [];
  await page.route("**/api/upload", (r) =>
    r.fulfill({
      status: 201,
      json: { sessionId: "s1", documents: DOCS.map((d) => ({ documentId: d.documentId, filename: d.filename, pageCount: d.pages })) },
    }),
  );
  await page.route("**/api/extract", async (r) => {
    bodies.push(r.request().postDataJSON());
    await r.fulfill({ status: extract.status, json: extract.body });
  });
  return bodies;
}

async function upload(page: Page, consent: boolean) {
  await page.goto("/");
  await page.getByRole("button", { name: "Compare my documents" }).click();
  await page.getByLabel("Choose plan PDFs").setInputFiles([
    { name: "alpha-student-plan.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "beta-travel-plan.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
  ]);
  await expect(page.getByText("This isn't a PDF, so it was not added.")).toBeVisible();
  if (consent) await page.getByLabel(/Let Claude read the pages/).check();
  await page.getByRole("button", { name: "Read my documents" }).click();
}

test.use({ viewport: { width: 1440, height: 900 } });

test("uploaded plans line up on the same rows, in their own words", async ({ page }) => {
  const bodies = await mock(page, { status: 200, body: { engine: { documents: DOCS } } });
  await upload(page, true);
  await page.getByRole("button", { name: "See results" }).click();
  expect(bodies).toEqual([{ sessionId: "s1", cloudConsent: true }]);
  await expect(page.getByText("Demo data")).toHaveCount(0);

  const all = page.locator("table").first();
  for (const row of ["Deductible", "ER visit"]) await expect(all.getByRole("rowheader", { name: new RegExp(row) })).toBeVisible();
  await expect(all.getByText("$250 per Policy Year")).toBeVisible();
  await expect(all.getByText("$100 per Period of Coverage")).toBeVisible();
  await expect(all.getByText("Check page 1").first()).toBeVisible(); // nothing verified: no value shown
  // Coinsurance: stated by one, printed but unsettled in the other -> couldn't confirm, page 2
  await expect(page.getByRole("rowheader", { name: /Coinsurance/ })).toBeVisible();
  await expect(page.getByText("Check page 2").first()).toBeVisible();
  await expect(page.getByText("Not covered")).toHaveCount(0);
  // the unmapped benefit stays in the document's words: "good to know" (scope.md), so the
  // default filter counts it as hidden until the user shows everything
  await expect(page.locator("#filterbar")).toContainText("Hidden: 1 good to know");
  await page.getByRole("button", { name: "Show everything" }).click();
  await expect(page.getByRole("heading", { name: "Only in one plan" })).toBeVisible();
  await expect(page.getByText("Surgeon's benefit")).toBeVisible();

  await page.getByRole("button", { name: "Page 2" }).first().click();
  await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute(
    "src",
    /^\/api\/document\/s1\/d\d\/[a-z-]+\.pdf#page=\d$/,
  );
});

test("consent is sent only when the user ticks it", async ({ page }) => {
  const bodies = await mock(page, { status: 200, body: { engine: { documents: DOCS } } });
  await upload(page, false);
  await expect(page.getByRole("button", { name: "See results" })).toBeVisible();
  expect(bodies).toEqual([{ sessionId: "s1", cloudConsent: false }]);
});

test("a failed read shows a designed error with retry", async ({ page }) => {
  await mock(page, { status: 502, body: { error: { message: "The reading service is unavailable." } } });
  await upload(page, false);
  await expect(page.getByRole("heading", { name: "We couldn't read your documents" })).toBeVisible();
  await expect(page.getByText("The reading service is unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("when some checks couldn't run, the results say so plainly — never an error page", async ({ page }) => {
  const docs = DOCS.map((d, i) => ({ ...d, checksIncomplete: i === 0 }));
  await mock(page, { status: 200, body: { engine: { documents: docs } } });
  await upload(page, true);
  await expect(page.getByText("Some checks couldn't run right now")).toBeVisible();
  await page.getByRole("button", { name: "See results" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Some checks couldn't run right now" })).toBeVisible();
  await expect(page.getByText("$250 per Policy Year")).toBeVisible(); // what was read is still shown
  await expect(page.getByRole("heading", { name: "We couldn't read your documents" })).toHaveCount(0);
});

test("without a refusal there is no notice", async ({ page }) => {
  await mock(page, { status: 200, body: { engine: { documents: DOCS.map((d) => ({ ...d, checksIncomplete: false })) } } });
  await upload(page, true);
  await page.getByRole("button", { name: "See results" }).click();
  await expect(page.getByText("$250 per Policy Year")).toBeVisible();
  await expect(page.getByText("Some checks couldn't run right now")).toHaveCount(0);
});

test("a read that hits the time limit says so clearly", async ({ page }) => {
  const message =
    "Reading took longer than 15 minutes, so it was stopped. Nothing was saved. Please try again, or read fewer or shorter documents at a time.";
  await mock(page, { status: 504, body: { error: { code: "DEPENDENCY_UNAVAILABLE", message, retryable: true } } });
  await upload(page, true);
  await expect(page.getByRole("heading", { name: "We couldn't read your documents" })).toBeVisible();
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("/classic is no longer routed", async ({ page }) => {
  const res = await page.goto("/classic");
  expect(res?.status()).toBe(404);
});

test("a reload shows the saved results again", async ({ page }) => {
  await mock(page, { status: 200, body: { engine: { documents: DOCS } } });
  let saved = 0;
  await page.route("**/api/results/s1", (r) => {
    saved++;
    return r.fulfill({ status: 200, json: { sessionId: "s1", documents: [], engine: { documents: DOCS } } });
  });
  await upload(page, true);
  await page.getByRole("button", { name: "See results" }).click();
  await expect(page.getByText("$250 per Policy Year")).toBeVisible();
  await page.reload();
  await expect(page.getByText("$250 per Policy Year")).toBeVisible();
  expect(saved).toBe(1);
  await expect(page.getByRole("heading", { name: "Compare or understand your plans" })).toHaveCount(0);
});

test("saved results and documents need this session's capability", async ({ page, browser }) => {
  // the real upload route (no mock): it sets this browser's HttpOnly capability cookie
  const up = await page.request.post("/api/upload", {
    multipart: {
      documents: { name: "plan-a.pdf", mimeType: "application/pdf", buffer: readFileSync("tests/fixtures/plan-a.pdf") },
    },
  });
  expect(up.status()).toBe(201);
  const { sessionId, documents } = (await up.json()) as { sessionId: string; documents: { documentId: string }[] };
  const doc = `/api/document/${sessionId}/${documents[0].documentId}/plan-a.pdf`;

  const stranger = await browser.newContext();
  expect((await stranger.request.get(`/api/results/${sessionId}`)).status()).toBe(401);
  expect((await stranger.request.get(doc)).status()).toBe(401);
  await stranger.close();

  // the owner is authorized: no results saved yet (404), the document opens
  expect((await page.request.get(`/api/results/${sessionId}`)).status()).toBe(404);
  expect((await page.request.get(doc)).status()).toBe(200);
});
