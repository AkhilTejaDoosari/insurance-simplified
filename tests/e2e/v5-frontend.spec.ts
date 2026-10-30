import { expect, test } from "@playwright/test";

// Synthetic policy data only. The real upload route is exercised; external
// extraction/chat are replaced at the HTTP boundary for deterministic UI checks.
function review(count: number) {
  const names = ["Alpha", "Beta", "Gamma", "Omega", "Zeta"];
  const documents = names.slice(0, count).map((_, i) => ({
    documentId: `doc-${i}`,
    filename: `policy-${i}.pdf`,
    pageCount: 2,
  }));
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "v5-synthetic",
    documents,
    plans: names.slice(0, count).map((name, i) => ({
      planId: `plan-${i}`,
      name,
      sources: [{ documentId: `doc-${i}`, page: 1, quote: `${name} policy` }],
    })),
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: documents.flatMap((d, i) => [
          {
            documentId: d.documentId,
            planId: `plan-${i}`,
            display: `$${500 + i * 250}`,
            qualifiers: { networkTier: "in-network", planTier: "Standard" },
            evidence: [
              {
                documentId: d.documentId,
                page: 1,
                quote: `Standard deductible $${500 + i * 250} in-network`,
                evidenceId: `cost-${i}-standard`,
              },
            ],
          },
          {
            documentId: d.documentId,
            planId: `plan-${i}`,
            display: `$${750 + i * 250}`,
            qualifiers: { networkTier: "in-network", planTier: "Plus" },
            evidence: [
              {
                documentId: d.documentId,
                page: 1,
                quote: `Plus deductible $${750 + i * 250} in-network`,
                evidenceId: `cost-${i}-plus`,
              },
            ],
          },
        ]),
      },
      {
        factName: "pre-existing-conditions",
        verdict: "SUPPORTED",
        values: documents.map((d, i) => ({
          documentId: d.documentId,
          planId: `plan-${i}`,
          display: "Not covered",
          qualifiers: {},
          evidence: [
            {
              documentId: d.documentId,
              page: 2,
              quote: "Pre-existing conditions not covered",
              evidenceId: `risk-${i}`,
            },
          ],
        })),
      },
      {
        factName: "coverage-limit",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "doc-0",
            display: "$9,999 unassigned",
            qualifiers: {},
            evidence: [
              {
                documentId: "doc-0",
                page: 2,
                quote: "Option $9,999",
                evidenceId: "unassigned",
              },
            ],
          },
        ],
      },
    ],
    contacts: documents.map((d) => ({
      kind: "phone",
      value: "800-555-0100",
      purpose: "Claims",
      documentId: d.documentId,
      filename: d.filename,
      page: 2,
      quote: "Claims: 800-555-0100",
    })),
  };
}

async function openReview(
  page: import("@playwright/test").Page,
  count: number,
) {
  await page.route("**/api/extract", (r) => r.fulfill({ json: review(count) }));
  await page.goto("/");
  // Exclude only Next's development toolbar from design-review captures.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page
    .getByRole("button", { name: "I have my documents", exact: true })
    .click();
  await page.setInputFiles(
    'input[type="file"]',
    Array.from(
      { length: count },
      (_, i) => `tests/fixtures/plan-${i % 2 ? "b" : "a"}.pdf`,
    ),
  );
  await page
    .getByRole("button", {
      name: count === 1 ? "Understand my document" : "Compare my plans",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  if (count > 1) await page.getByRole("button", { name: "Compare policies", exact: true }).click();
}

test("Understand mode switches among uploaded PDFs without reprocessing or a comparison table", async ({
  page,
}) => {
  let extractCalls = 0;
  await page.route("**/api/extract", (route) => {
    extractCalls++;
    return route.fulfill({ json: review(3) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents", exact: true }).click();
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
    "tests/fixtures/plan-a.pdf",
  ]);
  await page.getByRole("button", { name: "Compare my plans", exact: true }).click();

  const documentPicker = page.getByLabel("Choose a document for individual reading");
  await expect(documentPicker.locator("option")).toHaveCount(3);
  await expect(page.getByRole("table")).toHaveCount(0);

  await documentPicker.selectOption("doc-2");
  await expect(page.locator(".policyPicker")).toContainText("policy-2.pdf");
  await expect(page.locator(".policyPicker")).toContainText("Gamma");
  await expect(page.getByRole("table")).toHaveCount(0);
  await documentPicker.selectOption("doc-0");
  await expect(page.locator(".policyPicker")).toContainText("Alpha");
  expect(extractCalls).toBe(1);
});

test("V5 integrated start accepts five PDFs, rejects a sixth, and supports guidance", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(
    page.getByRole("heading", {
      name: "Understand what your insurance actually covers.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Age", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("homepage-desktop.png"),
    fullPage: true,
  });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    await page.screenshot({
      path: info.outputPath(`homepage-mobile-${scheme}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: info.outputPath(`homepage-desktop-${scheme}.png`),
      fullPage: true,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page
    .getByRole("button", { name: "I have my documents", exact: true })
    .click();
  await page.setInputFiles(
    'input[type="file"]',
    Array(5).fill("tests/fixtures/plan-a.pdf"),
  );
  await expect(
    page.getByRole("button", { name: "Remove plan-a.pdf" }),
  ).toHaveCount(5);
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-b.pdf");
  await expect(page.locator(".alert[role=alert]")).toContainText(
    "up to 5 PDFs",
  );
  await expect(
    page.getByRole("button", { name: "Remove plan-a.pdf" }),
  ).toHaveCount(5);
  await page.screenshot({
    path: info.outputPath("intake-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "I don't have documents", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Build my checklist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Documents to collect" }),
  ).toBeVisible();
});

for (const count of [1, 2, 3]) {
  test(`V5 ${count}-plan review, ordering, evidence and persistent chat`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openReview(page, count);
    await expect(page.locator(".chatFloat")).toBeHidden();
    await expect(
      page.locator(".reviewActions").getByRole("button", { name: "Ask a question" }),
    ).toBeVisible();
    if (count > 1) {
      await expect(page.getByRole("table")).toHaveCount(1);
      await expect(page.locator(".table").first().locator("thead th")).toHaveCount(count + 1);
      await expect(page.locator(".table").first().locator("thead th").nth(1)).toContainText("All tiers shown");
      await expect(page.locator(".table").first()).toContainText("Standard tier");
      await expect(page.locator(".table").first()).toContainText("Plus tier");
      await expect(page.locator(".adaptiveResults")).toContainText("not directly comparable");
      await expect(page.locator(".table").first()).not.toContainText("$9,999 unassigned");
      await expect(page.locator("figure, .adaptiveTimeline")).toHaveCount(0);
      const summary = page.getByRole("region", {
        name: "The main things to check",
      });
      await expect
        .poll(() =>
          summary.evaluate((element) =>
            element.nextElementSibling?.getAttribute("aria-label"),
          ),
        )
        .toBe("Compare your policies");
    } else await expect(page.getByRole("table")).toHaveCount(0);
    if (count === 1) {
      await expect(page.locator(".adaptiveResults")).toContainText(
        "$9,999 unassigned",
      );
      await expect(page.locator(".adaptiveResults")).toContainText(
        "Unverified applicability",
      );
    } else {
      await expect(
        page.getByLabel("Document evidence requiring verification"),
      ).toContainText("$9,999 unassigned");
    }
    await expect(page.getByLabel("Contact the plan")).toBeVisible();
    expect(await page.locator(".brief").count()).toBeGreaterThan(0);
    expect(await page.locator(".brief").count()).toBeLessThanOrEqual(3);
    await expect(page.getByLabel("Your question")).not.toBeVisible();
    await page.screenshot({
      path: info.outputPath(`results-${count}-light-closed.png`),
      fullPage: true,
    });
    if (count > 1) {
      await page
        .getByRole("button", { name: "Move Alpha right", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".table").first().locator("thead th").nth(1)).toContainText(
        "Beta",
      );
      await expect(page.locator(".contactItem").first()).toContainText("Beta");
      await page
        .getByRole("button", { name: "Reset plan order to A to Z" })
        .click();
      await page
        .locator(".planChip")
        .first()
        .dragTo(page.locator(".planChip").nth(1));
      await expect(page.locator(".table").first().locator("thead th").nth(1)).toContainText(
        "Beta",
      );
    }
    await page
      .getByRole("button", { name: "Ask a question", exact: true })
      .first()
      .click();
    await expect(page.getByLabel("Your question")).toBeFocused();
    await page.getByLabel("Your question").fill("Keep this draft");
    await page.evaluate(() => window.scrollTo(0, 0));
    const widths = await page
      .locator(".results-workspace")
      .evaluate((el) =>
        getComputedStyle(el).gridTemplateColumns.split(" ").map(parseFloat),
      );
    expect(widths[0] / widths[1]).toBeCloseTo(3, 0);
    await page.screenshot({
      path: info.outputPath(`results-${count}-light-chat.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close chat" }).click();
    await page
      .getByRole("button", { name: "Ask a question", exact: true })
      .first()
      .click();
    await expect(page.getByLabel("Your question")).toHaveValue(
      "Keep this draft",
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: info.outputPath(`results-${count}-dark-chat.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(
      page.getByRole("dialog", { name: "Document assistant" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close chat" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Ask", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Close chat" }),
    ).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`mobile-${count}-dark-chat.png`),
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(375);
    await expect(page.locator(".chatFloat")).toBeVisible();
    await expect(page.locator(".chatFloat")).toHaveCSS("position", "static");
    await page.screenshot({
      path: info.outputPath(`mobile-${count}-dark-results.png`),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({
      path: info.outputPath(`mobile-${count}-light-results.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Ask a question", exact: true })
      .first()
      .click();
    await page.screenshot({
      path: info.outputPath(`mobile-${count}-light-chat.png`),
    });
    await page.getByRole("button", { name: "Close chat" }).click();
    await page
      .getByRole("button", { name: /Ask about Annual deductible/ })
      .first()
      .click();
    await expect(page.getByLabel("Your question")).toHaveValue(
      /annual deductible/,
    );
    await page.getByRole("button", { name: "Close chat" }).click();
  });
}

test("five uploaded documents display at most three plans and selection/order reach chat and export", async ({
  page,
}, info) => {
  await openReview(page, 5);
  await expect(page.locator(".table").first().locator("thead th")).toHaveCount(4);
  const picker = page.getByRole("group", { name: "Select plans to compare" });
  await expect(picker.getByLabel("Compare Omega", { exact: true })).toBeDisabled();
  await picker.getByLabel("Compare Alpha", { exact: true }).uncheck();
  await expect(page.getByRole("columnheader", { name: "Alpha" })).toHaveCount(0);
  await picker.getByLabel("Compare Alpha", { exact: true }).check();
  await expect(page.getByRole("columnheader", { name: "Alpha" })).toBeVisible();
  await picker.getByLabel("Compare Alpha", { exact: true }).uncheck();
  await picker.getByLabel("Compare Omega", { exact: true }).check();
  await expect(page.getByRole("columnheader", { name: "Omega" })).toBeVisible();

  const betaHandle = page.getByRole("button", {
    name: "Reorder Beta using left and right arrow keys",
  });
  await betaHandle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".table").first().locator("thead th").nth(1)).toContainText("Gamma");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".table").first().locator("thead th").nth(1)).toContainText("Beta");

  await page
    .getByRole("button", { name: "Move Omega left", exact: true })
    .click();
  await expect(page.locator(".contactItem").first()).toContainText("Beta");
  await page.getByLabel("Tier shown for Beta").selectOption("Plus");
  await expect(page.getByRole("columnheader", { name: /Beta/ })).toContainText(
    "Selected tier: Plus",
  );
  await expect(page.getByRole("columnheader", { name: /Omega/ })).toContainText(
    "All tiers shown",
  );
  await page.screenshot({
    path: info.outputPath("v5-final-comparison-desktop-light.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: info.outputPath("v5-final-comparison-desktop-dark.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "light" });
  let exported: unknown;
  await page.route("**/api/export", async (route) => {
    exported = route.request().postDataJSON().selection;
    await route.fulfill({
      status: 409,
      json: {
        error: {
          message:
            "Synthetic UI snapshot check; use the real-flow export test for PDF generation.",
        },
      },
    });
  });
  await page.getByRole("button", { name: /Download report/ }).click();
  await expect
    .poll(() => exported)
    .toMatchObject({
      planIds: ["plan-1", "plan-3", "plan-2"],
      tiers: { "plan-1": "Plus" },
    });
  await page.route("**/api/chat", (route) => {
    expect(route.request().postDataJSON().selection).toEqual(exported);
    return route.fulfill({
      json: { kind: "refusal", refusalText: "Synthetic scoped response" },
    });
  });
  await page
    .getByRole("button", { name: "Ask a question", exact: true })
    .first()
    .click();
  await page.getByLabel("Your question").fill("What should I check?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Synthetic scoped response")).toBeVisible();
});

test("PDF drop and mixed invalid files preserve useful selections", async ({
  page,
}) => {
  await page.goto("/");
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["%PDF-1.7 synthetic drop"], "dropped.pdf", {
        type: "application/pdf",
      }),
    );
    data.items.add(
      new File(["not a policy"], "invalid.txt", { type: "text/plain" }),
    );
    return data;
  });
  await page
    .locator(".upload")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByRole("button", { name: "Remove dropped.pdf" }),
  ).toBeVisible();
  await expect(page.locator(".alert")).toContainText("invalid.txt");
  await expect(
    page.getByRole("button", { name: "Remove invalid.txt" }),
  ).toHaveCount(0);
});
