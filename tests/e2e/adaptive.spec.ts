import { test, expect } from "@playwright/test";
import type { RegisteredComparisonTable } from "../../app/lib/extraction/types";

const names = ["Alpha", "Beta", "Gamma", "Omega"];
function fixture(): RegisteredComparisonTable & { contacts: unknown[] } {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "adaptive-e2e",
    documents: names.map((name, i) => ({
      documentId: `d${i}`,
      filename: `${name}.pdf`,
      pageCount: 2,
    })),
    plans: names.map((name, i) => ({
      planId: `p${i}`,
      name,
      sources: [{ documentId: `d${i}`, page: 1, quote: `${name} policy` }],
    })),
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: names.map((_, i) => ({
          documentId: `d${i}`,
          planId: `p${i}`,
          display: `${500 + i * 250} USD`,
          qualifiers: {
            currency: "USD",
            period: "per year",
            selectionStatus: "purchased",
          },
          evidence: [
            {
              documentId: `d${i}`,
              page: 1,
              quote: `Your selected deductible is ${500 + i * 250} USD per year`,
              evidenceId: `ev-cost-${i}`,
            },
          ],
        })),
      },
      {
        factName: "waiting-period",
        verdict: "SUPPORTED",
        values: names.map((_, i) => ({
          documentId: `d${i}`,
          planId: `p${i}`,
          display: `${30 + i * 10} days`,
          qualifiers: {},
          evidence: [
            {
              documentId: `d${i}`,
              page: 2,
              quote: `Waiting period ${30 + i * 10} days`,
              evidenceId: `ev-wait-${i}`,
            },
          ],
        })),
      },
      {
        factName: "material-exclusions",
        verdict: "SUPPORTED",
        values: [
          {
            documentId: "d0",
            display: "Hazardous sports excluded",
            qualifiers: {},
            evidence: [
              {
                documentId: "d0",
                page: 2,
                quote: "Hazardous sports excluded",
                evidenceId: "ev-unassigned",
              },
            ],
          },
        ],
      },
    ],
    contacts: [],
  };
}

test("one PDF retains independent plan and tier choices in individual and comparison modes", async ({ page }, info) => {
  const data = fixture();
  data.documents = data.documents.slice(0, 1);
  data.plans = data.plans!.slice(0, 2).map((p) => ({ ...p, sources: p.sources.map((s) => ({ ...s, documentId: "d0" })) }));
  data.rows = data.rows.map((row) => ({ ...row, values: row.values.filter((v) => !v.planId || ["p0", "p1"].includes(v.planId)).flatMap((v) => {
    const value = { ...v, documentId: "d0", evidence: v.evidence.map((e) => ({ ...e, documentId: "d0" })) };
    if (row.factName !== "annual-deductible") return [value];
    return ["Basic", "Elite"].map((tier, i) => {
      const amount = (v.planId === "p0" ? 500 : 750) + i * 450;
      return { ...value, display: `${amount} USD`, qualifiers: { ...v.qualifiers, planTier: tier }, evidence: [{ documentId: "d0", page: 1, quote: `Your selected ${tier} deductible is ${amount} USD per year`, evidenceId: `ev-${v.planId}-${tier}` }] };
    });
  }) }));
  await page.route("**/api/extract", (r) => r.fulfill({ json: data }));
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents", exact: true }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document", exact: true }).click();
  await page.getByLabel("Plan within this document").selectOption("p1");
  await page.getByLabel("Tier shown for Beta").selectOption("Elite");
  await expect(page.locator(".adaptiveResults")).toContainText("1200 USD");
  await expect(page.locator(".adaptiveResults")).not.toContainText("750 USD");
  await expect(page.locator(".adaptiveResults")).not.toContainText("500 USD");
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(page.locator(".adaptiveTable").first().locator("thead th")).toHaveCount(3);
  await page.getByLabel("Tier shown for Alpha").selectOption("Basic");
  await page.getByLabel("Tier shown for Beta").selectOption("Basic");
  await expect(page.locator(".adaptiveTable").first()).toContainText("750 USD");
  await expect(page.locator(".adaptiveTable").first()).not.toContainText("1200 USD");
  await page.getByRole("button", { name: "Understand one policy", exact: true }).click();
  await expect(page.getByLabel("Tier shown for Beta")).toHaveValue("Elite");
  await expect(page.locator(".adaptiveResults")).toContainText("1200 USD");
  await page.getByLabel("Plan within this document").selectOption("");
  await expect(page.locator(".adaptiveResults")).not.toContainText("1200 USD");
  await expect(page.locator(".adaptiveResults")).toContainText("Unverified applicability");
  await page.screenshot({ path: info.outputPath("one-pdf-document-evidence.png"), fullPage: true });
});

test("adaptive modes retain independent scope, reorder, chat and active export", async ({
  page,
}, info) => {
  await page.route("**/api/extract", (route) =>
    route.fulfill({ json: fixture() }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "I have my documents", exact: true })
    .click();
  await page.setInputFiles(
    'input[type="file"]',
    Array(4).fill("tests/fixtures/plan-a.pdf"),
  );
  await page
    .getByRole("button", { name: "Compare my plans", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Understand one policy", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".adaptiveResults")).toHaveAttribute(
    "data-view-mode",
    "understand",
  );
  await expect(page.locator(".adaptiveResults table")).toHaveCount(0);
  await page
    .getByLabel("Choose a document for individual reading")
    .selectOption("d2");
  await expect(page.locator(".adaptiveResults")).toContainText("1000 USD");
  await expect(page.locator(".adaptiveResults")).not.toContainText(
    "Hazardous sports",
  );
  await page
    .getByRole("button", { name: "Compare policies", exact: true })
    .click();
  await expect(
    page.locator(".adaptiveTable").first().locator("thead th"),
  ).toHaveCount(4);
  await expect(page.locator(".adaptiveTable").first()).not.toContainText(
    "Hazardous sports",
  );
  await page
    .getByRole("button", { name: "Move Alpha right", exact: true })
    .click();
  await expect(
    page.locator(".adaptiveTable").first().locator("thead th").nth(1),
  ).toContainText("Beta");
  await page
    .locator(".planChip")
    .first()
    .dragTo(page.locator(".planChip").nth(2));
  await expect(
    page.locator(".adaptiveTable").first().locator("thead th").nth(3),
  ).toContainText("Beta");
  await page
    .getByRole("button", { name: "Understand one policy", exact: true })
    .click();
  await expect(
    page.getByLabel("Choose a document for individual reading"),
  ).toHaveValue("d2");
  await page
    .getByRole("button", { name: "Compare policies", exact: true })
    .click();
  await expect(
    page.locator(".adaptiveTable").first().locator("thead th").nth(3),
  ).toContainText("Beta");
  await page
    .getByRole("button", { name: "Reset plan order to A to Z" })
    .click();
  await page.getByLabel("Compare Gamma").uncheck();
  await expect(
    page.locator(".adaptiveTable").first().locator("thead th"),
  ).toHaveCount(3);
  await page.getByLabel("Compare Gamma").check();
  let asked: Record<string, unknown> | undefined;
  await page.route("**/api/chat", async (route) => {
    asked = route.request().postDataJSON().selection;
    await route.fulfill({
      json: {
        schemaVersion: "v1",
        kind: "refusal",
        refusalText: "No supporting evidence in this selection.",
      },
    });
  });
  await page
    .getByRole("button", { name: "Ask a question", exact: true })
    .first()
    .click();
  await page.getByLabel("Your question").fill("What should I verify?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(() => asked?.viewMode).toBe("compare");
  expect(asked?.planIds).toEqual(["p0", "p1", "p2"]);
  await page.getByRole("button", { name: "Close chat" }).click();
  await page
    .getByRole("button", { name: "Understand one policy", exact: true })
    .click();
  let exported: Record<string, unknown> | undefined;
  await page.route("**/api/export", async (route) => {
    exported = route.request().postDataJSON().selection;
    await route.fulfill({
      status: 409,
      json: { error: { message: "Synthetic export check" } },
    });
  });
  await page
    .getByRole("button", { name: "Download report", exact: false })
    .click();
  await expect.poll(() => exported?.documentId).toBe("d2");
  expect(exported?.planIds).toEqual(["p2"]);
  await page.getByRole("button", { name: "About", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "About Insurance Simplified" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close About", exact: true }).click();
  for (const width of [1440, 375])
    for (const colorScheme of ["light", "dark"] as const)
      for (const mode of ["understand", "compare"] as const) {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page
          .getByRole("button", {
            name:
              mode === "understand"
                ? "Understand one policy"
                : "Compare policies",
            exact: true,
          })
          .click();
        await page.addStyleTag({
          content: "nextjs-portal { display:none !important }",
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: info.outputPath(`${mode}-${width}-${colorScheme}.png`),
          fullPage: true,
        });
      }
});
