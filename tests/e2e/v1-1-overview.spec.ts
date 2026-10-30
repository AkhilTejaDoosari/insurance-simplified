import { expect, test } from "@playwright/test";

const FIXTURE = "tests/fixtures/plan-a.pdf";

function mockExtractResponse(
  page: import("@playwright/test").Page,
  payload: unknown,
) {
  return page.route("**/api/extract", (route) =>
    route.fulfill({ json: payload }),
  );
}

async function fillContext(
  page: import("@playwright/test").Page,
  city: string,
  zip: string,
) {
  await page.getByLabel("City").fill(city);
  await page.getByLabel("ZIP / postal code").fill(zip);
}

async function uploadAndExtract(
  page: import("@playwright/test").Page,
  city = "Cleveland",
  zip = "44118",
) {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await fillContext(page, city, zip);
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.getByRole("button", { name: "Understand my document" }).click();
}

test("overview precedes the comparison table and surfaces up to three sourced findings", async ({
  page,
}) => {
  await mockExtractResponse(page, {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-overview-1",
    documents: [
      { documentId: "doc-1", filename: "brochure.pdf", pageCount: 2 },
    ],
    plans: [
      {
        planId: "plan-alpha",
        name: "Alpha",
        sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
      },
    ],
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$0–$2,500",
            qualifiers: { selectionStatus: "selectable" },
            evidence: [
              {
                documentId: "doc-1",
                page: 2,
                quote: "Deductible options: $0, $500, $1,000, $2,500.",
                evidenceId: "ev-deductible",
              },
            ],
          },
        ],
      },
      {
        factName: "premium",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$120/mo",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-1",
                page: 2,
                quote: "Monthly premium is $120.",
                evidenceId: "ev-premium",
              },
            ],
          },
        ],
      },
      {
        factName: "emergency-evacuation",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "Up to $1,000,000",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-1",
                page: 2,
                quote: "Emergency medical evacuation up to $1,000,000.",
                evidenceId: "ev-evac",
              },
            ],
          },
        ],
      },
    ],
  });
  await uploadAndExtract(page);

  const overview = page.getByRole("region", { name: "The main things to check", exact: true });
  await expect(overview).toBeVisible();
  await expect(overview).toContainText("The main things to check");
  await expect(overview).toContainText("Annual deductible");
  await expect(overview).toContainText("$0–$2,500");
  await expect(overview).toContainText("your purchased option is not stated");
  await expect(overview).toContainText("Premium / price");
  await expect(overview).toContainText("$120/mo");
  await expect(overview).toContainText("Emergency medical evacuation");

  // Overview appears before the comparison table.
  const table = page.locator(".adaptiveFact");
  await expect(table.first()).toBeVisible();
  const overviewBox = await overview.boundingBox();
  const tableBox = await table.first().boundingBox();
  expect(overviewBox?.y).toBeLessThan(tableBox?.y ?? Infinity);
});

test("overview highlights a residence conflict with a source link and action", async ({
  page,
}) => {
  await mockExtractResponse(page, {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-overview-2",
    documents: [
      { documentId: "doc-1", filename: "brochure.pdf", pageCount: 2 },
    ],
    plans: [
      {
        planId: "plan-alpha",
        name: "Alpha",
        sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
      },
    ],
    rows: [
      {
        factName: "international-coverage",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "Country of residence excluded",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-1",
                page: 2,
                quote:
                  "This policy does not cover claims made in the insured person's country of residence.",
                evidenceId: "ev-residence",
              },
            ],
          },
        ],
      },
    ],
  });
  await uploadAndExtract(page);

  const overview = page.getByRole("region", { name: "The main things to check", exact: true });
  await expect(overview).toContainText("Potential conflict");
  await expect(overview).toContainText("country of residence");
  const sourceLink = overview.getByRole("link", {
    name: /View source evidence.*brochure.pdf, page 2/,
  });
  await expect(sourceLink).toHaveAttribute(
    "href",
    /page=2&evidence=ev-residence/,
  );
});

test("selection and context: overview costs change with A tier while B unchanged, and section switching preserves selection", async ({
  page,
}) => {
  await mockExtractResponse(page, {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-overview-3",
    documents: [
      { documentId: "doc-a", filename: "alpha.pdf", pageCount: 2 },
      { documentId: "doc-b", filename: "beta.pdf", pageCount: 2 },
    ],
    plans: [
      {
        planId: "plan-a",
        name: "Alpha",
        sources: [{ documentId: "doc-a", page: 1, quote: "Plan name: Alpha" }],
      },
      {
        planId: "plan-b",
        name: "Beta",
        sources: [{ documentId: "doc-b", page: 1, quote: "Plan name: Beta" }],
      },
    ],
    presentationGroups: [
      { title: "Costs", factNames: ["annual-deductible"] },
      { title: "Emergency", factNames: ["emergency-evacuation"] },
    ],
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-a",
            planId: "plan-a",
            display: "$250",
            qualifiers: { planTier: "Lite" },
            evidence: [
              {
                documentId: "doc-a",
                page: 2,
                quote: "Lite deductible $250.",
                evidenceId: "ev-a-lite",
              },
            ],
          },
          {
            documentId: "doc-a",
            planId: "plan-a",
            display: "$500",
            qualifiers: { planTier: "Platinum" },
            evidence: [
              {
                documentId: "doc-a",
                page: 2,
                quote: "Platinum deductible $500.",
                evidenceId: "ev-a-plat",
              },
            ],
          },
          {
            documentId: "doc-b",
            planId: "plan-b",
            display: "$750",
            qualifiers: { planTier: "Lite" },
            evidence: [
              {
                documentId: "doc-b",
                page: 2,
                quote: "Lite deductible $750.",
                evidenceId: "ev-b-lite",
              },
            ],
          },
          {
            documentId: "doc-b",
            planId: "plan-b",
            display: "$1,000",
            qualifiers: { planTier: "Platinum" },
            evidence: [
              {
                documentId: "doc-b",
                page: 2,
                quote: "Platinum deductible $1,000.",
                evidenceId: "ev-b-plat",
              },
            ],
          },
        ],
      },
      {
        factName: "emergency-evacuation",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-a",
            planId: "plan-a",
            display: "Up to $1M",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-a",
                page: 2,
                quote: "Evacuation up to $1M.",
                evidenceId: "ev-a-evac",
              },
            ],
          },
          {
            documentId: "doc-b",
            planId: "plan-b",
            display: "Up to $500K",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-b",
                page: 2,
                quote: "Evacuation up to $500K.",
                evidenceId: "ev-b-evac",
              },
            ],
          },
        ],
      },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await fillContext(page, "Cleveland", "44118");
  await page.setInputFiles('input[type="file"]', [FIXTURE, FIXTURE]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();

  const overview = page.getByRole("region", { name: "The main things to check", exact: true });
  await expect(overview).toContainText("Annual deductible");

  // The short version is distinct and bounded; full tier facts stay in the matrix.
  expect(await overview.locator(".brief").count()).toBeLessThanOrEqual(3);
  const matrix = page.getByRole("table");
  await expect(matrix).toContainText("$500");
  await expect(matrix).toContainText("$1,000");

  // Select Lite for Alpha only.
  const alphaTier = page.getByLabel("Tier shown for Alpha");
  await alphaTier.selectOption("Lite");
  await expect(alphaTier).toHaveValue("Lite");

  // Alpha Platinum should disappear; Alpha Lite and both Beta tiers remain.
  await expect(overview).toContainText("$250");
  await expect(matrix).toContainText("$1,000");
  await expect(overview).not.toContainText("$500");

  // Read the next continuous section; Alpha tier choice persists.
  await page
    .getByRole("rowheader", { name: "Emergency medical evacuation" })
    .scrollIntoViewIfNeeded();
  await expect(alphaTier).toHaveValue("Lite");
});

test("selection and context: context update refreshes overview costs and does not keep a stale unknown", async ({
  page,
}) => {
  const initialTable = {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-overview-4",
    documents: [
      { documentId: "doc-1", filename: "brochure.pdf", pageCount: 2 },
    ],
    plans: [
      {
        planId: "plan-alpha",
        name: "Alpha",
        sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
      },
    ],
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$250",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-1",
                page: 2,
                quote: "Annual deductible $250.",
                evidenceId: "ev-ded",
              },
            ],
          },
        ],
      },
      {
        factName: "premium",
        verdict: "NEEDS VERIFICATION",
        rationale: "Varies by age.",
        values: [],
      },
    ],
  };
  const updatedTable = {
    ...initialTable,
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$250",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-1",
                page: 2,
                quote: "Annual deductible $250.",
                evidenceId: "ev-ded",
              },
            ],
          },
        ],
      },
      {
        factName: "premium",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$145",
            qualifiers: { ageBand: "30-34" },
            evidence: [
              {
                documentId: "doc-1",
                page: 2,
                quote: "Ages 30-34 monthly premium is $145.",
                evidenceId: "ev-prem",
              },
            ],
          },
        ],
      },
    ],
  };
  await page.route("**/api/extract", async (route) => {
    const body = route.request().postDataJSON() ?? {};
    if (body.context?.age) return route.fulfill({ json: updatedTable });
    return route.fulfill({ json: initialTable });
  });
  await uploadAndExtract(page);

  const overview = page.getByRole("region", { name: "The main things to check", exact: true });
  await expect(overview).not.toContainText("Varies by age.");

  // Provide the missing age through the table prompt.
  const premiumRow = page.locator(".adaptiveContextQuestion").filter({ hasText: "Premium / price" });
  await premiumRow.getByRole("button", { name: "Add information" }).click();
  await page.getByLabel("Age for Premium / price").fill("30");
  await page.getByRole("button", { name: "Apply" }).click();

  // Overview should now show the age-matched premium and drop the stale unknown.
  await expect(overview).toContainText("$145");
  await expect(overview).toContainText("Ages: 30-34");
  await expect(overview).not.toContainText("Varies by age.");
});
