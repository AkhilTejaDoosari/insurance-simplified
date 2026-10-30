import { expect, test } from "@playwright/test";
import { registered } from "./registered-fixture";

const FIXTURE_A = "tests/fixtures/plan-a.pdf";
const FIXTURE_B = "tests/fixtures/plan-b.pdf";

function mockExtractResponse(
  page: import("@playwright/test").Page,
  payload: unknown,
) {
  return page.route("**/api/extract", (route) =>
    route.fulfill({ json: registered(payload) }),
  );
}

async function startIntake(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
}

const singlePlanTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  resultFingerprint: "fp-single",
  documents: [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 }],
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
            { documentId: "doc-1", page: 2, quote: "Annual deductible $250" },
          ],
        },
      ],
    },
  ],
};

const threePlanTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  resultFingerprint: "fp-three",
  documents: [
    { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 },
    { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 2 },
    { documentId: "doc-3", filename: "plan-b.pdf", pageCount: 2 },
  ],
  plans: [
    {
      planId: "plan-alpha",
      name: "Alpha",
      sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
    },
    {
      planId: "plan-beta",
      name: "Beta",
      sources: [{ documentId: "doc-2", page: 1, quote: "Plan name: Beta" }],
    },
    {
      planId: "plan-gamma",
      name: "Gamma",
      sources: [{ documentId: "doc-3", page: 1, quote: "Plan name: Gamma" }],
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
            { documentId: "doc-1", page: 2, quote: "Deductible $250" },
          ],
        },
        {
          documentId: "doc-2",
          planId: "plan-beta",
          display: "$500",
          qualifiers: {},
          evidence: [
            { documentId: "doc-2", page: 2, quote: "Deductible $500" },
          ],
        },
        {
          documentId: "doc-3",
          planId: "plan-gamma",
          display: "$750",
          qualifiers: {},
          evidence: [
            { documentId: "doc-3", page: 2, quote: "Deductible $750" },
          ],
        },
      ],
    },
  ],
};

const fivePlanTable = {
  schemaVersion: "v1",
  factListVersion: "v1",
  resultFingerprint: "fp-five",
  documents: [
    { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 },
    { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 2 },
    { documentId: "doc-3", filename: "plan-b.pdf", pageCount: 2 },
    { documentId: "doc-4", filename: "plan-a.pdf", pageCount: 2 },
    { documentId: "doc-5", filename: "plan-b.pdf", pageCount: 2 },
  ],
  plans: [
    {
      planId: "plan-alpha",
      name: "Alpha",
      sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
    },
    {
      planId: "plan-beta",
      name: "Beta",
      sources: [{ documentId: "doc-2", page: 1, quote: "Plan name: Beta" }],
    },
    {
      planId: "plan-gamma",
      name: "Gamma",
      sources: [{ documentId: "doc-3", page: 1, quote: "Plan name: Gamma" }],
    },
    {
      planId: "plan-delta",
      name: "Delta",
      sources: [{ documentId: "doc-4", page: 1, quote: "Plan name: Delta" }],
    },
    {
      planId: "plan-epsilon",
      name: "Epsilon",
      sources: [{ documentId: "doc-5", page: 1, quote: "Plan name: Epsilon" }],
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
            { documentId: "doc-1", page: 2, quote: "Deductible $250" },
          ],
        },
        {
          documentId: "doc-2",
          planId: "plan-beta",
          display: "$500",
          qualifiers: {},
          evidence: [
            { documentId: "doc-2", page: 2, quote: "Deductible $500" },
          ],
        },
        {
          documentId: "doc-3",
          planId: "plan-gamma",
          display: "$750",
          qualifiers: {},
          evidence: [
            { documentId: "doc-3", page: 2, quote: "Deductible $750" },
          ],
        },
        {
          documentId: "doc-4",
          planId: "plan-delta",
          display: "$1,000",
          qualifiers: {},
          evidence: [
            { documentId: "doc-4", page: 2, quote: "Deductible $1,000" },
          ],
        },
        {
          documentId: "doc-5",
          planId: "plan-epsilon",
          display: "$1,500",
          qualifiers: {},
          evidence: [
            { documentId: "doc-5", page: 2, quote: "Deductible $1,500" },
          ],
        },
      ],
    },
  ],
};

test("one PDF renders an individual reading without empty comparison columns", async ({
  page,
}) => {
  await mockExtractResponse(page, singlePlanTable);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', FIXTURE_A);
  await page.getByRole("button", { name: "Understand my document" }).click();

  await expect(page.locator(".adaptiveResults")).toContainText("Alpha");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Annual deductible/ }).first()).toBeVisible();
  await expect(page.locator(".adaptiveResults")).toContainText("$250");
});

test("three PDFs render three plan columns with real shortlist controls", async ({
  page,
}) => {
  await mockExtractResponse(page, threePlanTable);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [
    FIXTURE_A,
    FIXTURE_B,
    FIXTURE_B,
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();

  const table = page.getByRole("table");
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    await expect(table.getByRole("columnheader", { name })).toBeVisible();
  }
  await expect(table.locator("thead").getByRole("columnheader")).toHaveCount(4); // factor + three plans
  await expect(page.locator(".plan-picker")).toBeVisible();
});

test("five PDFs establishing more than three plans show a plan picker capped at three", async ({
  page,
}) => {
  await mockExtractResponse(page, fivePlanTable);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [
    FIXTURE_A,
    FIXTURE_B,
    FIXTURE_B,
    FIXTURE_A,
    FIXTURE_B,
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare your policies" }),
  ).toBeVisible();

  const picker = page.locator(".plan-picker");
  await expect(picker).toBeVisible();
  const checkboxes = picker.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(5);

  const table = page.getByRole("table");
  await expect(table.locator("thead").getByRole("columnheader")).toHaveCount(4); // factor + three selected
  // Default selection is the verified A–Z order: Alpha, Beta, Delta.
  await expect(
    table.getByRole("columnheader", { name: "Alpha" }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Beta" })).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: "Delta" }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Gamma" })).toHaveCount(
    0,
  );
});

test("plan picker lets the user swap a selected plan while keeping three columns", async ({
  page,
}) => {
  await mockExtractResponse(page, fivePlanTable);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [
    FIXTURE_A,
    FIXTURE_B,
    FIXTURE_B,
    FIXTURE_A,
    FIXTURE_B,
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare your policies" }),
  ).toBeVisible();

  const picker = page.locator(".plan-picker");
  const alpha = picker
    .locator("label", { hasText: "Alpha" })
    .getByRole("checkbox");
  const gamma = picker
    .locator("label", { hasText: "Gamma" })
    .getByRole("checkbox");

  await alpha.uncheck();
  await gamma.check();

  const table = page.getByRole("table");
  await expect(
    table.getByRole("columnheader", { name: "Gamma" }),
  ).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Alpha" })).toHaveCount(
    0,
  );
  await expect(
    table.getByRole("columnheader", { name: "Delta" }),
  ).toBeVisible();
  await expect(table.locator("thead").getByRole("columnheader")).toHaveCount(4);
  await expect(
    table.locator(".cell-value").filter({ hasText: "$750" }),
  ).toBeVisible();
});

test("plan picker prevents selecting a fourth plan", async ({ page }) => {
  await mockExtractResponse(page, fivePlanTable);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [
    FIXTURE_A,
    FIXTURE_B,
    FIXTURE_B,
    FIXTURE_A,
    FIXTURE_B,
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare your policies" }),
  ).toBeVisible();

  const picker = page.locator(".plan-picker");
  // Gamma is an unselected plan beyond the three-column cap.
  const gamma = picker
    .locator("label", { hasText: "Gamma" })
    .getByRole("checkbox");
  await expect(gamma).toBeDisabled();
  await expect(picker).toContainText("Choose up to three plans");
});

test("All tiers keeps one column per plan with tier-labeled details", async ({
  page,
}) => {
  const tieredTable = {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-tiers",
    documents: [{ documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 }],
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
            qualifiers: { planTier: "Lite" },
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Lite deductible $250" },
            ],
          },
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$500",
            qualifiers: { planTier: "Gold" },
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Gold deductible $500" },
            ],
          },
        ],
      },
    ],
  };
  await mockExtractResponse(page, tieredTable);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', FIXTURE_A);
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();

  const table = page.locator(".adaptiveResults");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(table.getByText("Tier: Lite").first()).toBeVisible();
  await expect(table.getByText("Tier: Gold").first()).toBeVisible();
  await expect(
    table.locator(".cell-value").filter({ hasText: "$250" }).first(),
  ).toBeVisible();
  await expect(
    table.locator(".cell-value").filter({ hasText: "$500" }).first(),
  ).toBeVisible();

  // Selecting a specific tier still keeps one column.
  await page.getByLabel("Tier shown for Alpha").selectOption("Gold");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(table.getByText("$500").first()).toBeVisible();
  await expect(table.getByText("Tier: Lite")).toHaveCount(0);
});

test("sixth PDF is rejected with a limit message while preserving the five selected files", async ({
  page,
}) => {
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [
    FIXTURE_A,
    FIXTURE_B,
    FIXTURE_B,
    FIXTURE_A,
    FIXTURE_B,
  ]);

  const fileList = page.locator(".file-list");
  await expect(fileList.getByText("plan-a.pdf")).toHaveCount(2);
  await expect(fileList.getByText("plan-b.pdf")).toHaveCount(3);

  // Attempting to add one more PDF shows the limit message and leaves the prior files intact.
  await page.setInputFiles('input[type="file"]', FIXTURE_A);
  await expect(page.locator('[role="alert"].alert')).toContainText(
    "up to 5 PDFs",
  );
  await expect(fileList.getByText("plan-a.pdf")).toHaveCount(2);
  await expect(fileList.getByText("plan-b.pdf")).toHaveCount(3);

  // The user can remove a file and then add a different one.
  const firstRemove = fileList.getByRole("button", { name: /Remove/ }).first();
  await firstRemove.click();
  await expect(fileList.locator("li")).toHaveCount(4);
  await page.setInputFiles('input[type="file"]', FIXTURE_A);
  await expect(fileList.locator("li")).toHaveCount(5);
  await expect(page.locator('[role="alert"].alert')).toHaveCount(0);
});

test("plan columns can be reordered manually and reset to A–Z (Phase C)", async ({
  page,
}) => {
  const tieredPlans = {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-order",
    documents: [
      { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 },
      { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 2 },
      { documentId: "doc-3", filename: "plan-b.pdf", pageCount: 2 },
    ],
    plans: [
      {
        planId: "plan-beta",
        name: "Beta",
        sources: [{ documentId: "doc-2", page: 1, quote: "Plan name: Beta" }],
      },
      {
        planId: "plan-alpha",
        name: "Alpha",
        sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
      },
      {
        planId: "plan-gamma",
        name: "Gamma",
        sources: [{ documentId: "doc-3", page: 1, quote: "Plan name: Gamma" }],
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
            qualifiers: { planTier: "Lite" },
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Lite deductible $250" },
            ],
          },
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$500",
            qualifiers: { planTier: "Gold" },
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Gold deductible $500" },
            ],
          },
          {
            documentId: "doc-2",
            planId: "plan-beta",
            display: "$500",
            qualifiers: { planTier: "Lite" },
            evidence: [
              { documentId: "doc-2", page: 2, quote: "Lite deductible $500" },
            ],
          },
          {
            documentId: "doc-3",
            planId: "plan-gamma",
            display: "$750",
            qualifiers: {},
            evidence: [
              { documentId: "doc-3", page: 2, quote: "Deductible $750" },
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
            display: "Up to $1M",
            qualifiers: {},
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Evacuation up to $1M" },
            ],
          },
        ],
      },
    ],
    presentationGroups: [
      { title: "Cost choices", factNames: ["annual-deductible"] },
      { title: "Emergency care", factNames: ["emergency-evacuation"] },
    ],
  };
  await mockExtractResponse(page, tieredPlans);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [
    FIXTURE_A,
    FIXTURE_B,
    FIXTURE_B,
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare your policies" }),
  ).toBeVisible();

  const table = page.getByRole("table");
  const headers = () => table.locator("thead th");

  // The upload declares Beta first, but the default order is verified A–Z.
  await expect(headers().nth(1)).toContainText("Alpha");
  await expect(headers().nth(2)).toContainText("Beta");
  await expect(headers().nth(3)).toContainText("Gamma");

  // Move Alpha right; column order follows the manual order.
  await page.getByRole("button", { name: "Move Alpha right" }).click();
  await expect(headers().nth(1)).toContainText("Beta");
  await expect(headers().nth(2)).toContainText("Alpha");
  await expect(headers().nth(3)).toContainText("Gamma");

  // Switch sections first (Coverage has content for Alpha), then exercise
  // the tier control: manual order must survive both.
  await expect(
    table.locator(".cell-value").filter({ hasText: "$1M" }),
  ).toBeVisible();
  await page.getByLabel("Tier shown for Alpha").selectOption("All tiers");
  await expect(headers().nth(1)).toContainText("Beta");
  await expect(headers().nth(2)).toContainText("Alpha");
  await expect(headers().nth(3)).toContainText("Gamma");

  // Reset restores the verified alphabetical default.
  await page
    .getByRole("button", { name: "Reset plan order to A to Z" })
    .click();
  await expect(headers().nth(1)).toContainText("Alpha");
  await expect(headers().nth(2)).toContainText("Beta");
  await expect(headers().nth(3)).toContainText("Gamma");
});

test("uploads without a verifiable plan identity show the unconfirmed label, never a filename title (Phase B)", async ({
  page,
}) => {
  const legacyTable = {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-legacy",
    documents: [
      { documentId: "doc-1", filename: "4-plan-a-final.pdf", pageCount: 2 },
      { documentId: "doc-2", filename: "7-brochure.pdf", pageCount: 2 },
    ],
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            display: "$250",
            qualifiers: {},
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Deductible $250" },
            ],
          },
          {
            documentId: "doc-2",
            display: "$500",
            qualifiers: {},
            evidence: [
              { documentId: "doc-2", page: 2, quote: "Deductible $500" },
            ],
          },
        ],
      },
    ],
  };
  await mockExtractResponse(page, legacyTable);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [FIXTURE_A, FIXTURE_B]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();

  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compare policies", exact: true })).toBeDisabled();
  await expect(page.locator(".adaptiveResults")).toContainText("Unverified applicability");
  await expect(page.locator(".adaptiveResults")).not.toContainText("4 Plan A Final");
  await expect(page.locator(".adaptiveResults")).not.toContainText("7 Brochure");
});

test("continuous sections preserve plan and tier selections", async ({
  page,
}) => {
  const table = {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-sections",
    documents: [
      { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 2 },
      { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 2 },
    ],
    plans: [
      {
        planId: "plan-alpha",
        name: "Alpha",
        sources: [{ documentId: "doc-1", page: 1, quote: "Plan name: Alpha" }],
      },
      {
        planId: "plan-beta",
        name: "Beta",
        sources: [{ documentId: "doc-2", page: 1, quote: "Plan name: Beta" }],
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
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$250",
            qualifiers: { planTier: "Lite" },
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Lite deductible $250" },
            ],
          },
          {
            documentId: "doc-1",
            planId: "plan-alpha",
            display: "$500",
            qualifiers: { planTier: "Gold" },
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Gold deductible $500" },
            ],
          },
          {
            documentId: "doc-2",
            planId: "plan-beta",
            display: "$750",
            qualifiers: {},
            evidence: [
              { documentId: "doc-2", page: 2, quote: "Deductible $750" },
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
            display: "Up to $1M",
            qualifiers: {},
            evidence: [
              { documentId: "doc-1", page: 2, quote: "Evacuation up to $1M" },
            ],
          },
          {
            documentId: "doc-2",
            planId: "plan-beta",
            display: "Up to $500K",
            qualifiers: {},
            evidence: [
              { documentId: "doc-2", page: 2, quote: "Evacuation up to $500K" },
            ],
          },
        ],
      },
    ],
  };
  await mockExtractResponse(page, table);
  await startIntake(page);
  await page.setInputFiles('input[type="file"]', [FIXTURE_A, FIXTURE_B]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare your policies" }),
  ).toBeVisible();

  await expect(page.locator(".comparison__tabs")).toHaveCount(0);
  await expect(
    page.getByRole("rowheader", { name: "Emergency medical evacuation" }),
  ).toBeVisible();
  await page.getByLabel("Tier shown for Alpha").selectOption("Gold");
  await page
    .getByRole("rowheader", { name: "Emergency medical evacuation" })
    .scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Tier shown for Alpha")).toHaveValue("Gold");
});
