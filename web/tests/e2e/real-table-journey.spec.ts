// Real-document journey: upload an actual tiered brochure → the results show
// column-scoped table claims for the verified plan → each value opens the
// original PDF at its cited page with a unique evidence highlight.
// The brochure and its expected labels are licensed and live outside git:
// REAL_FIXTURES_DIR/e2e/real-table-journey.json names the PDF (path relative
// to the repo root) and what to expect. Skipped (never passed) if absent.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

// V1 screens are no longer routed (owner, 2026-11-28: hide V1, delete later). Kept until the
// V2 screen renders through the evidence-core gate; reported as SKIPPED, never as passing.
test.skip(true, "V1 /classic is not routed (owner 2026-11-28)");

interface JourneyFixture { pdf: string; factHeading: string; rowLabel: string; citedPage: number; pageCount: number }
const fixtureFile = process.env.REAL_FIXTURES_DIR
  ? join(resolve(process.env.REAL_FIXTURES_DIR), "e2e", "real-table-journey.json")
  : "";
const J: JourneyFixture | undefined = fixtureFile && existsSync(fixtureFile)
  ? JSON.parse(readFileSync(fixtureFile, "utf8"))
  : undefined;
const PDF = J?.pdf ?? "";

test.skip(!J || !existsSync(PDF), "real-document fixtures not present (set REAL_FIXTURES_DIR)");

test("tiered brochure: table claims are plan-verified and open their evidence", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/classic");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', [PDF]);
  await page.getByRole("button", { name: "Understand my document" }).click();

  // The brief leads with the plan's verified facts, not stray document lines.
  const brief = page.getByRole("region", { name: "The main things to check" });
  await expect(brief.locator("article").first()).toBeVisible({ timeout: 30_000 });
  await expect(brief.locator("article").first()).not.toContainText("Unverified applicability");
  await page.getByRole("button", { name: /Read all \d+ details/ }).click({ timeout: 30_000 });
  const j = J!;
  const fact = page
    .locator(".adaptiveResults article")
    .filter({ has: page.getByRole("heading", { name: j.factHeading, exact: true }) })
    .first();
  await expect(fact).toBeVisible({ timeout: 30_000 });
  // A table claim for the verified plan: column-scoped, verbatim, not flagged.
  await expect(fact).toContainText(j.rowLabel);
  await expect(fact).not.toContainText("Unverified applicability");
  // Distinct table rows of one tier are distinct provisions, not a conflict.
  await expect(fact).not.toContainText("Conflicting evidence");

  const value = fact.locator(".cell-value").first();
  await expect(value).toHaveAttribute("href", new RegExp(`/view/sess-[^/]+/doc-1/[^?]+\\?page=${j.citedPage}&evidence=ev-[0-9a-f]{16}$`));
  const [viewer] = await Promise.all([page.waitForEvent("popup"), value.click()]);
  await expect(viewer.getByText(`Page ${j.citedPage} of ${j.pageCount}`)).toBeVisible({ timeout: 30_000 });
  await viewer.waitForFunction(
    () => document.querySelector('[data-testid="pdf-evidence-viewer"][data-evidence-state="unique"]') !== null,
    undefined,
    { timeout: 30_000 },
  );
  await expect(viewer.getByTestId("evidence-highlight").first()).toBeVisible();
});
