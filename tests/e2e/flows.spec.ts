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
  await expect(page.getByText("CONFLICTED").first()).toBeVisible();
  await expect(page.getByText("NOT STATED").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /\$250 in-network \/ \$500 out-of-network/ }).first()
  ).toBeVisible();

  // Flow 2: cell click reveals document, page, exact quote.
  await page
    .getByRole("button", { name: /\$250 in-network \/ \$500 out-of-network/ })
    .first()
    .click();
  const evidence = page.getByLabel("Evidence");
  await expect(evidence.getByText("doc-1, page 1", { exact: false })).toBeVisible();
  // Citation links end in the filename so the PDF tab is titled after it.
  await expect(evidence.getByRole("link", { name: "page 1" }).first()).toHaveAttribute(
    "href",
    /\/api\/document\/sess-[^/]+\/doc-1\/plan-a\.pdf#page=1$/,
  );
  await expect(evidence.getByText(/Annual deductible: \$250 in-network/).first()).toBeVisible();

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
