import { expect, test } from "@playwright/test";

// The deterministic engine can't name tiers, so the tiered table is served
// by mocking /api/extract with the shape the LLM path produces (planTier).
const tier = (tier: string, display: string) => ({
  documentId: "doc-2",
  display,
  qualifiers: { planTier: tier },
  evidence: [{ documentId: "doc-2", page: 1, quote: `${tier}: ${display}` }],
});

const TIERED_TABLE = {
  schemaVersion: "v1",
  factListVersion: "v1",
  documents: [
    { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1 },
    { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 1 },
  ],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "NEEDS VERIFICATION",
      values: [
        {
          documentId: "doc-1",
          display: "$250 in-network / $500 out-of-network",
          qualifiers: {},
          evidence: [{ documentId: "doc-1", page: 1, quote: "Annual deductible: $250" }],
        },
        tier("Lite", "$0 to $2,500"),
        tier("Plus", "$0 to $2,500"),
        tier("Platinum", "$0 to $25,000"),
      ],
    },
    {
      factName: "emergency-care",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-2",
          display: "Emergency medical evacuation up to $1,000,000",
          qualifiers: {},
          evidence: [{ documentId: "doc-2", page: 2, quote: "Emergency medical evacuation" }],
        },
      ],
    },
  ],
};

test("multi-tier document gets one column per tier and a tier picker", async ({ page }) => {
  await page.route("**/api/extract", (route) =>
    route.fulfill({ json: TIERED_TABLE }),
  );
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
  ]);
  await page.getByRole("button", { name: "Compare documents" }).click();

  const table = page.getByRole("table");
  // Three tier sub-columns under the brochure; single-tier plan-a unchanged.
  for (const t of ["Lite", "Plus", "Platinum"]) {
    await expect(table.getByRole("columnheader", { name: t, exact: true })).toBeVisible();
  }
  await expect(table.getByRole("columnheader", { name: "plan-a.pdf" })).toBeVisible();
  await expect(table.getByRole("button", { name: "$0 to $25,000" })).toBeVisible();
  await expect(table.getByRole("button", { name: "$0 to $2,500" })).toHaveCount(2);
  // A tier-agnostic value spans the tier columns once, not three times.
  await expect(table.getByRole("button", { name: /evacuation/ })).toHaveCount(1);

  // Picking one tier collapses the group to a single column.
  const picker = page.getByLabel("Tier shown for plan-b.pdf");
  await expect(picker).toHaveValue("__all__");
  await picker.selectOption("Platinum");
  await expect(table.getByRole("columnheader", { name: "Platinum", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Lite", exact: true })).toHaveCount(0);
  await expect(table.getByRole("button", { name: "$0 to $2,500" })).toHaveCount(0);
  await expect(table.getByRole("button", { name: "$0 to $25,000" })).toBeVisible();

  await picker.selectOption("__all__");
  await expect(table.getByRole("columnheader", { name: "Lite", exact: true })).toBeVisible();
  // The tier sub-header sticks below the measured document header row.
  const tierTop = await table
    .getByRole("columnheader", { name: "Lite", exact: true })
    .evaluate((el) => parseFloat(getComputedStyle(el).top));
  expect(tierTop).toBeGreaterThan(0);
});
