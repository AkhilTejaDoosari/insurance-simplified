import { expect, test } from "@playwright/test";

test("navigation and states preserve intake and valid results across app and browser back", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Edit details/ }).click();
  await expect(page.getByLabel("Age", { exact: true })).toHaveValue("34");
  await page.getByRole("button", { name: "Return to results" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Age", { exact: true })).toHaveValue("34");
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
});

test("navigation and states keep checklist document-free and invalidate results on replacement", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /don't know where to start/ }).click();
  await expect(
    page.getByRole("button", { name: "Build my checklist" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Your plans/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "I already have documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Edit details/ }).click();
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "PROVIDER_UNAVAILABLE", retryable: true },
      }),
    });
  });
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-b.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(page.getByText(/provider.*unavailable/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return to results" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
});

test("navigation and states distinguish an expired session from retryable provider errors", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAUTHORIZED" } }),
    });
  });
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(page.getByText(/session.*expired/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("navigation and states let a user open the checklist from intake with a retained result", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Edit details/ }).click();
  await page
    .getByRole("button", { name: "I don't have documents", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No documents yet? Start here" }),
  ).toBeVisible();
});

test("navigation and states preserve a selected legacy tier on an intake round-trip", async ({
  page,
}) => {
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "v1",
        factListVersion: "v1",
        documents: [
          { documentId: "doc-1", filename: "policy.pdf", pageCount: 1 },
        ],
        rows: [
          {
            factName: "annual-deductible",
            verdict: "SUPPORTED",
            values: ["Lite", "Gold"].map((tier) => ({
              documentId: "doc-1",
              display: tier === "Lite" ? "$250" : "$500",
              qualifiers: { planTier: tier },
              evidence: [
                { documentId: "doc-1", page: 1, quote: `${tier} deductible`, evidenceId: `ev-${tier}` },
              ],
            })),
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  // Legacy uploads carry no verifiable plan identity; the tier control is
  // labelled with the unconfirmed plan label, not the filename (Phase B).
  const selector = page.getByLabel("Tier shown for Plan name unconfirmed");
  await selector.selectOption("Gold");
  await page.getByRole("button", { name: /Edit details/ }).click();
  await page.getByRole("button", { name: "Return to results" }).click();
  await expect(selector).toHaveValue("Gold");
});

test("navigation and states retain independent proven plan tiers across sections and context refresh", async ({
  page,
}) => {
  const documents = ["a", "b"].map((documentId) => ({
    documentId,
    filename: `${documentId}.pdf`,
    pageCount: 1,
  }));
  const plans = ["a", "b"].map((documentId) => ({
    planId: documentId,
    name: documentId.toUpperCase(),
    sources: [
      {
        documentId,
        page: 1,
        quote: `Policy name: ${documentId.toUpperCase()}`,
      },
    ],
  }));
  const rows = [
    { factName: "eligibility-for-you", verdict: "NOT STATED", values: [] },
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: ["a", "b"].flatMap((documentId) =>
        ["Lite", "Gold"].map((tier) => ({
          documentId,
          planId: documentId,
          display: tier === "Gold" ? "$500" : "$250",
          qualifiers: { planTier: tier },
          evidence: [
            {
              documentId,
              page: 1,
              quote: `Plan name: ${documentId.toUpperCase()}; annual-deductible: ${tier === "Gold" ? "$500" : "$250"}`,
              evidenceId: `ev-${documentId}-${tier}`,
            },
          ],
        })),
      ),
    },
  ];
  const presentationGroups = [
    { title: "Eligibility", factNames: ["eligibility-for-you"] },
    { title: "Costs", factNames: ["annual-deductible"] },
  ];
  let contextRequests = 0;
  await page.route("**/api/extract", (route) => {
    const context = route.request().postDataJSON().context;
    if (context) contextRequests++;
    return route.fulfill({
      json: {
        schemaVersion: "v1",
        factListVersion: "v1",
        documents,
        plans,
        presentationGroups,
        rows,
        resultFingerprint: context ? "context-updated" : "original-result",
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  const selectors = page.getByLabel(/Tier shown for/);
  await expect(selectors).toHaveCount(2);
  await selectors.nth(0).selectOption("Gold");
  await selectors.nth(1).selectOption("Lite");
  await expect(
    page.getByRole("button", { name: "Add information" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Add information" }).click();
  await page.getByLabel(/Visa \/ status for/).fill("F-1");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(selectors.nth(0)).toHaveValue("Gold");
  await expect(selectors.nth(1)).toHaveValue("Lite");
  await expect.poll(() => contextRequests).toBe(1);
  await expect(selectors.nth(0)).toHaveValue("Gold");
  await expect(selectors.nth(1)).toHaveValue("Lite");
});

test("navigation and states do not present results for changed intake details or replacement files", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Edit details/ }).click();
  await page.getByLabel("Age", { exact: true }).fill("35");
  await expect(
    page.getByRole("button", { name: "Return to results" }),
  ).toHaveCount(0);
  await page.goBack();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-b.pdf");
  await expect(
    page.getByRole("button", { name: "Return to results" }),
  ).toHaveCount(0);
});

test("navigation and states reject extraction completed after intake details changed", async ({
  page,
}) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/extract", async (route) => {
    await hold;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(page.getByText(/Extracting insurance terms/)).toBeVisible();
  await page.getByLabel("Age", { exact: true }).fill("35");
  const completed = page.waitForResponse((response) =>
    response.url().endsWith("/api/extract"),
  );
  release();
  await completed;
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/details changed while we were reading/i),
  ).toBeVisible();
});

test("navigation and states ignore an older upload after selecting a replacement PDF", async ({
  page,
}) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploads = 0;
  await page.route("**/api/upload", async (route) => {
    uploads++;
    if (uploads === 1) await hold;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(page.getByText(/Uploading and reading/)).toBeVisible();
  // Replace the in-flight file by removing it and adding the new one.
  await page.getByRole("button", { name: /Remove plan-a\.pdf/ }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-b.pdf");
  const completed = page.waitForResponse((response) =>
    response.url().endsWith("/api/upload"),
  );
  release();
  await completed;
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Return to results" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  expect(uploads).toBe(2);
});

test("navigation and states do not navigate over a later checklist choice when extraction completes", async ({
  page,
}) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/extract", async (route) => {
    await hold;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByText(/Extracting insurance terms and preparing your results/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "I don't have documents", exact: true })
    .click();
  const completed = page.waitForResponse((response) =>
    response.url().endsWith("/api/extract"),
  );
  release();
  await completed;
  await expect(
    page.getByRole("heading", { name: "No documents yet? Start here" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
});

test("navigation and states ignore an old session's late context response after document replacement", async ({
  page,
}) => {
  let release!: () => void;
  let requestStarted!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const oldTable = {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "old.pdf", pageCount: 1 }],
    rows: [
      { factName: "eligibility-for-you", verdict: "NOT STATED", values: [] },
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            display: "$250",
            qualifiers: {},
            evidence: [
              { documentId: "doc-1", page: 1, quote: "Annual deductible $250", evidenceId: "ev-deductible" },
            ],
          },
        ],
      },
    ],
  };
  let initial = true;
  await page.route("**/api/extract", async (route) => {
    const body = route.request().postDataJSON();
    if (body.context) {
      requestStarted();
      await hold;
      await route.fulfill({ json: { ...oldTable, rows: [oldTable.rows[0]] } });
    } else if (initial) {
      initial = false;
      await route.fulfill({ json: oldTable });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await page.getByRole("button", { name: "Add information" }).first().click();
  await page.getByLabel(/Visa \/ status for/).fill("F-1");
  await page.getByRole("button", { name: "Apply" }).click();
  await started;
  await page.getByRole("button", { name: /Edit details/ }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-b.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.locator(".adaptiveFact").getByRole("heading", { name: "Annual deductible", exact: true }),
  ).toBeVisible();
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/extract") &&
      response.request().postData()?.includes('"context"') === true,
  );
  release();
  await completed;
  await expect(
    page.locator(".adaptiveFact").getByRole("heading", { name: "Annual deductible", exact: true }),
  ).toBeVisible();
});

test("navigation and states serialize context updates within the same session", async ({
  page,
}) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let contextRequests = 0;
  const original = {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "old.pdf", pageCount: 1 }],
    presentationGroups: [
      { title: "Eligibility", factNames: ["eligibility-for-you"] },
      { title: "Age rules", factNames: ["age-limits"] },
    ],
    plans: [
      {
        planId: "alpha",
        name: "Alpha",
        sources: [{ documentId: "doc-1", page: 1, quote: "Alpha" }],
      },
    ],
    rows: [
      { factName: "eligibility-for-you", verdict: "NOT STATED", values: [] },
      {
        factName: "age-limits",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-1",
            planId: "alpha",
            display: "Age 18 to 60",
            qualifiers: {},
            evidence: [{ documentId: "doc-1", page: 1, quote: "Age 18 to 60", evidenceId: "ev-age" }],
          },
        ],
      },
    ],
  };
  await page.route("**/api/extract", async (route) => {
    const context = route.request().postDataJSON().context as
      { visaOrStatus?: string; age?: string } | undefined;
    if (!context) return route.fulfill({ json: original });
    contextRequests++;
    if (context.visaOrStatus === "F-1") {
      await hold;
      return route.fulfill({
        json: {
          ...original,
          rows: [
            ...original.rows,
            {
              factName: "annual-deductible",
              verdict: "SUPPORTED",
              values: [
                {
                  documentId: "doc-1",
                  display: "$250",
                  qualifiers: {},
                  evidence: [{ documentId: "doc-1", page: 1, quote: "$250", evidenceId: "ev-ded" }],
                },
              ],
            },
          ],
        },
      });
    }
    return route.fulfill({ json: { ...original, rows: [original.rows[0]] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await page
    .locator(".adaptiveContextQuestion").filter({ hasText: /Eligibility for you/i })
    .getByRole("button", { name: "Add information" })
    .click();
  await page.getByLabel(/Visa \/ status for Eligibility/).fill("F-1");
  await page.getByRole("button", { name: "Apply" }).click();
  // A second context update in another continuous section must remain blocked.
  await page
    .locator(".adaptiveFact").filter({ hasText: /Age limits/ })
    .getByRole("button", { name: "Add information" })
    .click();
  await page.getByLabel(/Age for Age limits/).fill("35");
  await page
    .locator(".adaptiveFact").filter({ hasText: /Age limits/ })
    .getByRole("button", { name: "Apply" })
    .click();
  await expect(page.getByText(/another update is in progress/i)).toBeVisible();
  expect(contextRequests).toBe(1);
  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/extract") &&
      response.request().postData()?.includes("F-1") === true,
  );
  release();
  await completed;
  // Context updates recompute the section-scoped comparison table; the added
  // deductible row lives in My Costs, so move to that section before asserting.
  await expect(
    page.locator(".adaptiveFact").getByRole("heading", { name: "Annual deductible", exact: true }),
  ).toBeVisible();
});

test("navigation and states hide an expired contextual assessment instead of leaving stale results", async ({
  page,
}) => {
  const original = {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "old.pdf", pageCount: 1 }],
    rows: [
      { factName: "eligibility-for-you", verdict: "NOT STATED", values: [] },
    ],
  };
  await page.route("**/api/extract", (route) =>
    route.request().postDataJSON().context
      ? route.fulfill({
          status: 401,
          json: {
            error: { code: "SESSION_AUTH_REQUIRED", message: "Unauthorized" },
          },
        })
      : route.fulfill({ json: original }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await page.getByRole("button", { name: "Add information" }).click();
  await page.getByLabel(/Visa \/ status for/).fill("F-1");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/session.*expired/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Download report/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("navigation and states hide a failed contextual assessment but offer a provider retry", async ({
  page,
}) => {
  const original = {
    schemaVersion: "v1",
    factListVersion: "v1",
    documents: [{ documentId: "doc-1", filename: "old.pdf", pageCount: 1 }],
    rows: [
      { factName: "eligibility-for-you", verdict: "NOT STATED", values: [] },
    ],
  };
  await page.route("**/api/extract", (route) =>
    route.request().postDataJSON().context
      ? route.fulfill({
          status: 503,
          json: { error: { code: "PROVIDER_UNAVAILABLE", retryable: true } },
        })
      : route.fulfill({ json: original }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await page.getByRole("button", { name: "Add information" }).click();
  await page.getByLabel(/Visa \/ status for/).fill("F-1");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/provider.*unavailable/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("navigation and states keep edited intake instead of applying an older in-flight upload", async ({
  page,
}) => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploads = 0;
  await page.route("**/api/upload", async (route) => {
    uploads++;
    if (uploads === 1) await hold;
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(page.getByText(/Uploading and reading/)).toBeVisible();
  await page.getByLabel("Age", { exact: true }).fill("35");
  const completed = page.waitForResponse((response) =>
    response.url().endsWith("/api/upload"),
  );
  release();
  await completed;
  await expect(page.getByLabel("Age", { exact: true })).toHaveValue("35");
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toHaveCount(0);
  await expect(page.getByText(/details changed.*submit again/i)).toBeVisible();
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  expect(uploads).toBe(2);
});
