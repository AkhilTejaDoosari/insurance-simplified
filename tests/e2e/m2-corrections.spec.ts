import { expect, test } from "@playwright/test";

test("M2: verified plans remain separate and same-plan contradictions show both sources", async ({
  page,
}) => {
  const cited = (
    planId: string,
    name: string,
    display: string,
    sourcePage: number,
  ) => ({
    documentId: "doc-1",
    planId,
    display,
    qualifiers: {},
    evidence: [
      {
        documentId: "doc-1",
        page: sourcePage,
        quote: `Plan name: ${name}; annual-deductible: ${display}`,
        evidenceId: `ev-${planId}-${sourcePage}`,
      },
    ],
  });
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "v1",
        factListVersion: "v1",
        documents: [
          { documentId: "doc-1", filename: "brochure.pdf", pageCount: 2 },
        ],
        plans: ["Alpha", "Beta"].map((name) => ({
          planId: name.toLowerCase(),
          name,
          sources: [
            { documentId: "doc-1", page: 1, quote: `Plan name: ${name}` },
          ],
        })),
        rows: [
          {
            factName: "annual-deductible",
            verdict: "SUPPORTED",
            values: [
              cited("alpha", "Alpha", "$250", 1),
              cited("alpha", "Alpha", "$500", 2),
              cited("beta", "Beta", "$750", 2),
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  const cells = page
    .getByRole("row", { name: /Annual deductible/ })
    .locator("td");
  await expect(cells).toHaveCount(2);
  await expect(cells.nth(0)).toContainText("Conflicting evidence");
  await expect(cells.nth(0)).toContainText("$250");
  await expect(cells.nth(0)).toContainText("$500");
  await expect(cells.nth(0)).not.toContainText("$750");
  await expect(cells.nth(0).getByRole("link")).toHaveCount(2);
  await expect(cells.nth(1)).toContainText("$750");
  await expect(cells.nth(1)).not.toContainText("Conflicting evidence");
});

test("M2: ambiguous figures and unsupported qualifiers remain visibly unresolved and cited", async ({
  page,
}) => {
  const copay =
    "Emergency room copay: $100 in-network / $200 / $300 out-of-network. Choose your doctor.";
  const reimbursement =
    "Selected services coinsurance: 100% in-network / 90% / 100% out-of-network.";
  const cited = (
    display: string,
    quote: string,
    qualifiers: Record<string, string>,
  ) => ({
    documentId: "doc-1",
    display,
    qualifiers,
    evidence: [
      { documentId: "doc-1", page: 1, quote, evidenceId: "ev-review" },
    ],
  });
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "v1",
        factListVersion: "v1",
        documents: [
          { documentId: "doc-1", filename: "brochure.pdf", pageCount: 1 },
        ],
        rows: [
          {
            factName: "annual-deductible",
            verdict: "SUPPORTED",
            values: [
              cited("$250", "Annual deductible: $250.", {
                networkTier: "Preferred PPO",
                ageBand: "25-29",
                frequency: "monthly",
                currency: "EUR",
              }),
            ],
          },
          {
            factName: "coinsurance",
            verdict: "NEEDS VERIFICATION",
            values: [
              cited("100% / 90% / 100%", reimbursement, {
                networkTier: "in-network",
              }),
            ],
          },
          {
            factName: "emergency-care",
            verdict: "NEEDS VERIFICATION",
            values: [cited(copay, copay, {})],
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  const evidence = page.locator(".adaptiveResults .adaptiveFacts article");
  const deductible = evidence
    .filter({
      has: page.getByRole("heading", {
        name: "Annual deductible",
        exact: true,
      }),
    });
  await expect(deductible).toContainText("$250");
  await expect(deductible).not.toContainText(/Preferred PPO|25-29|monthly|EUR/);
  const coinsurance = evidence
    .filter({ has: page.getByRole("heading", { name: /Coinsurance/ }) });
  await expect(coinsurance).toContainText("100% / 90% / 100%");
  await expect(coinsurance).toContainText(/Unresolved:.*Confirm/);
  await expect(coinsurance).not.toContainText("Network: in-network");
  await expect(
    coinsurance.getByRole("link", { name: /View source evidence/ }),
  ).toHaveAttribute("href", /page=1&evidence=ev-review/);
  const emergency = evidence
    .filter({
      has: page.getByRole("heading", { name: "Emergency room", exact: true }),
    });
  await expect(emergency).toContainText(/\$100.*\$200.*\$300/);
  await expect(emergency).toContainText(/Unresolved:.*Confirm/);
  await expect(
    emergency.getByRole("link", { name: /View source evidence/ }),
  ).toHaveAttribute("href", /page=1&evidence=ev-review/);
});
