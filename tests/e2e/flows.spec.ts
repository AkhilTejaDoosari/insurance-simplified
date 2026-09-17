import { expect, test } from "@playwright/test";

test("upload → table → evidence → chat → export (quickstart Flows 1–4, 6)", async ({
  page,
}) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
  ]);
  await page.getByRole("button", { name: "Compare documents" }).click();

  // Flow 1: table with verdicts and full qualifiers.
  await expect(page.getByRole("rowheader", { name: "Annual deductible" })).toBeVisible();
  // Cross-plan differences are comparison data: differing values render as
  // SUPPORTED, never CONFLICTED.
  await expect(page.getByText("SUPPORTED").first()).toBeVisible();
  await expect(page.getByText("NOT STATED").first()).toBeVisible();
  // Each value is a direct source link (one click → viewer). Labels name the
  // fact, file, and page; the LLM engine may split or combine the display
  // text, so match the stable label rather than the figure.
  const valueLink = page
    .getByRole("link", { name: /View source evidence for Annual deductible — plan-a\.pdf, page 1/ })
    .first();
  await expect(valueLink).toBeVisible();
  // Each value links to its OWN evidence: document, page, opaque evidence ID.
  await expect(valueLink).toHaveAttribute(
    "href",
    /\/view\/sess-[^/]+\/doc-1\/plan-a\.pdf\?page=1&evidence=ev-[0-9a-f]{16}$/,
  );
  const [viewer] = await Promise.all([
    page.waitForEvent("popup"),
    valueLink.click(),
  ]);
  await expect(viewer.getByText("Page 1 of 2")).toBeVisible();
  await expect(viewer.getByText(/Annual deductible/).first()).toBeVisible();
  // The viewer renders the ACTUAL cited source page (PDF.js canvas, not an
  // iframe of a rewritten file), with the full original reachable separately.
  await expect(viewer.locator("canvas").first()).toBeVisible();
  // The evidence highlight overlays the rendered PDF page itself.
  await expect(viewer.getByTestId("evidence-highlight").first()).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Open full original PDF" })).toHaveAttribute(
    "href",
    /\/api\/document\/sess-[^/]+\/doc-1\/plan-a\.pdf$/,
  );
  // An invalid citation page fails explicitly instead of showing another page.
  await viewer.goto(viewer.url().replace(/page=1(&|$)/, "page=99$1"));
  await expect(viewer.getByText(/does not exist/)).toBeVisible();
  // The cited passage highlight sits on the rendered PDF page.
  await viewer.goto(viewer.url().replace(/page=99(&|$)/, "page=1$1"));
  await expect(viewer.getByTestId("evidence-highlight").first()).toBeVisible();

  // Flow 3: cited answer, then explicit refusal.
  await page.getByLabel("Your question").fill("What is the emergency copay?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("doc-1, page 1:").first()).toBeVisible();
  await page.getByLabel("Your question").fill("Does this cover space tourism?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("no supporting evidence")).toBeVisible();

  // Flow 4: insurer questions name facts.
  await expect(page.getByLabel("Questions to ask your insurer")).toContainText(
    "maternity-coverage"
  );

  // Flow 6: export downloads valid JSON.
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByText("Download export (JSON)").click(),
  ]);
  const path = await download[0].path();
  expect(path).toBeTruthy();
});

test("no-documents checklist flow (quickstart Flow 5)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /don't have documents/ }).click();
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.getByRole("button", { name: "Build my checklist" }).click();
  await expect(page.getByText("Documents to collect")).toBeVisible();
  await expect(page.getByText(/age-based limits.*34/)).toBeVisible();
  await page.getByRole("button", { name: /I have my documents/ }).click();
  await expect(page.getByText("Upload 2–4 insurance PDFs")).toBeVisible();
});
