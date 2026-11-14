// Real-document journey: upload an actual tiered brochure → the results show
// column-scoped table claims for the verified plan → each value opens the
// original PDF at its cited page with a unique evidence highlight.
// The brochure is licensed and git-ignored: skipped (never passed) if absent.
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const PDF = "nonstandard/03_worldtrips_studentsecure.pdf";

test.skip(!existsSync(PDF), "licensed brochure not present in this checkout");

test("tiered brochure: table claims are plan-verified and open their evidence", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', [PDF]);
  await page.getByRole("button", { name: "Understand my document" }).click();

  // The brief leads with the plan's verified facts, not stray document lines.
  const brief = page.getByRole("region", { name: "The main things to check" });
  await expect(brief.locator("article").first()).toBeVisible({ timeout: 30_000 });
  await expect(brief.locator("article").first()).not.toContainText("Unverified applicability");
  await page.getByRole("button", { name: /Read all \d+ details/ }).click({ timeout: 30_000 });
  const maternity = page
    .locator(".adaptiveResults article")
    .filter({ has: page.getByRole("heading", { name: "Maternity", exact: true }) })
    .first();
  await expect(maternity).toBeVisible({ timeout: 30_000 });
  // A table claim for the verified plan: column-scoped, verbatim, not flagged.
  await expect(maternity).toContainText("Maternity Care for a Covered Pregnancy");
  await expect(maternity).not.toContainText("Unverified applicability");
  // Distinct table rows of one tier are distinct provisions, not a conflict.
  await expect(maternity).not.toContainText("Conflicting evidence");

  const value = maternity.locator(".cell-value").first();
  await expect(value).toHaveAttribute("href", /\/view\/sess-[^/]+\/doc-1\/[^?]+\?page=4&evidence=ev-[0-9a-f]{16}$/);
  const [viewer] = await Promise.all([page.waitForEvent("popup"), value.click()]);
  await expect(viewer.getByText("Page 4 of 8")).toBeVisible({ timeout: 30_000 });
  await viewer.waitForFunction(
    () => document.querySelector('[data-testid="pdf-evidence-viewer"][data-evidence-state="unique"]') !== null,
    undefined,
    { timeout: 30_000 },
  );
  await expect(viewer.getByTestId("evidence-highlight").first()).toBeVisible();
});
