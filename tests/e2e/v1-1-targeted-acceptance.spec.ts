import { expect, test } from "@playwright/test";
import { registered } from "./registered-fixture";

const PDF_A = "tests/fixtures/plan-a.pdf";
const DEDUCTIBLE_QUOTE =
  "Annual deductible: $250 in-network / $500 out-of-network.";

function acceptanceTable({
  documentId,
  filename,
  repeatedUnknowns = false,
}: {
  documentId: string;
  filename: string;
  repeatedUnknowns?: boolean;
}) {
  return {
    schemaVersion: "v1",
    factListVersion: "v1",
    resultFingerprint: "fp-targeted-acceptance",
    documents: [{ documentId, filename, pageCount: 2 }],
    plans: [
      {
        planId: "plan-a",
        name: "ACME HEALTH PLAN A",
        sources: [
          {
            documentId,
            page: 1,
            quote: "ACME HEALTH PLAN A - SUMMARY OF BENEFITS",
          },
        ],
      },
    ],
    rows: [
      {
        factName: "annual-deductible",
        verdict: "SUPPORTED",
        values: [
          {
            documentId,
            planId: "plan-a",
            display: "$250 in-network / $500 out-of-network",
            qualifiers: {},
            evidence: [{ documentId, page: 1, quote: DEDUCTIBLE_QUOTE }],
          },
        ],
      },
      ...(repeatedUnknowns
        ? [
            { factName: "premium", verdict: "NOT STATED", values: [] },
            {
              factName: "out-of-pocket-maximum",
              verdict: "NOT STATED",
              values: [],
            },
          ]
        : []),
      {
        factName: "prescriptions",
        verdict: "SUPPORTED",
        values: [
          {
            documentId,
            planId: "plan-a",
            display: "Covered at a reasonable cost",
            qualifiers: {},
            evidence: [
              {
                documentId,
                page: 2,
                quote: "Prescription coverage: covered at a reasonable cost.",
              },
            ],
          },
        ],
      },
      ...(repeatedUnknowns
        ? [
            {
              factName: "eligibility-for-you",
              verdict: "NOT STATED",
              values: [],
            },
          ]
        : []),
    ],
  };
}

async function beginUpload(
  page: import("@playwright/test").Page,
  age?: string,
) {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  if (age) await page.getByLabel("Age", { exact: true }).fill(age);
  await page.setInputFiles('input[type="file"]', PDF_A);
  await page.getByRole("button", { name: "Understand my document" }).click();
}

function mockExtractForUploadedDocument(
  page: import("@playwright/test").Page,
  repeatedUnknowns = false,
) {
  let uploaded: Promise<{ documentId: string; filename: string }> | undefined;
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/upload") {
      uploaded = response
        .json()
        .then(
          (body: { documents: { documentId: string; filename: string }[] }) =>
            body.documents[0],
        );
    }
  });
  void page.route("**/api/extract", async (route) => {
    if (!uploaded)
      throw new Error("Upload response was not observed before extraction");
    // Keep the actual route's authorization and citation registration for the
    // original fixture, then substitute only the synthetic reading projection.
    await route.fetch();
    await route.fulfill({
      json: registered(acceptanceTable({ ...(await uploaded), repeatedUnknowns })),
    });
  });
}

test("UX-24 keyboard-only journey reaches tier, details, and original PDF evidence", async ({
  page,
}) => {
  mockExtractForUploadedDocument(page, true);

  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Insurance Simplified home" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Toggle color theme" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const chooseDocuments = page.getByRole("button", {
    name: "I have my documents",
  });
  await expect(chooseDocuments).toBeFocused();
  expect(
    await chooseDocuments.evaluate((el) => getComputedStyle(el).outlineWidth),
  ).not.toBe("0px");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /Choose PDF files/ }),
  ).toBeVisible();

  await page.setInputFiles('input[type="file"]', PDF_A);
  const submit = page.getByRole("button", { name: "Understand my document" });
  await submit.focus();
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();

  // The approved fixture has no multiple-tier evidence, so the customer UI
  // must not invent a selector or tier choice for this keyboard journey.
  await expect(
    page.getByLabel("Tier shown for ACME HEALTH PLAN A"),
  ).toHaveCount(0);

  const details = page.locator(".verify__checks summary");
  await details.focus();
  await expect(details).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".verify__checks")).toHaveAttribute("open", "");

  const source = page
    .getByRole("link", { name: /View source evidence for Annual deductible/ })
    .first();
  await source.focus();
  await expect(source).toBeFocused();
  const viewerPromise = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const viewer = await viewerPromise;
  await expect(viewer).toHaveURL(/\/view\/.*page=1/);
  await expect(viewer.getByText("plan-a.pdf — Page 1 of 2")).toBeVisible();
  await viewer.close();
});

test("UX-32 unknowns stay out of the short version and remain available below", async ({
  page,
}) => {
  mockExtractForUploadedDocument(page, true);
  await beginUpload(page);

  const overview = page.getByRole("region", { name: "The main things to check", exact: true });
  await expect(overview).not.toContainText("Not stated");
  expect(await overview.locator(".brief").count()).toBeLessThanOrEqual(3);
  await page.locator(".verify__checks summary").click();
  await expect(page.locator(".verify__checks")).toHaveAttribute("open", "");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.locator(".adaptiveFact").getByRole("heading", { name: "Annual deductible", exact: true })).toBeVisible();
  await expect(page.locator(".adaptiveContextQuestion")).toContainText("Eligibility for you");
  await expect(page.locator(".adaptiveResults")).not.toContainText("Out-of-pocket maximum");

  const evidence = page.getByRole("link", {
    name: /View source evidence for Prescription drugs/,
  }).first();
  await expect(evidence).toHaveAttribute("href", /page=2/);
  await expect(
    page
      .getByRole("link", { name: /View source evidence for Annual deductible/ })
      .first(),
  ).toHaveAttribute("href", /page=1/);
});

test("UX-35 logo returns to intake, keeps the valid result, and repeated findings have unique keys", async ({
  page,
}) => {
  mockExtractForUploadedDocument(page, true);
  const duplicateKeyWarnings: string[] = [];
  page.on("console", (message) => {
    if (
      /same key|same value for the .key. prop|Encountered two children/i.test(
        message.text(),
      )
    ) {
      duplicateKeyWarnings.push(message.text());
    }
  });
  await beginUpload(page, "34");
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  await expect(
    page.locator(".adaptiveResults"),
  ).toContainText("ACME HEALTH PLAN A");
  await page.locator(".verify__checks summary").click();

  const capabilityBefore = (await page.context().cookies()).find(
    (cookie) => cookie.name === "sid_cap",
  )?.value;
  await page.getByRole("link", { name: "Insurance Simplified home" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Understand what your insurance actually covers.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "I have my documents" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I have my documents" }).click();
  await expect(page.getByLabel("Age", { exact: true })).toHaveValue("34");
  await expect(
    page.getByRole("button", { name: "Return to results" }),
  ).toBeVisible();
  const capabilityAfter = (await page.context().cookies()).find(
    (cookie) => cookie.name === "sid_cap",
  )?.value;
  expect(capabilityAfter).toBe(capabilityBefore);
  await page.getByRole("button", { name: "Return to results" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  await expect(
    page.locator(".adaptiveResults"),
  ).toContainText("ACME HEALTH PLAN A");
  await expect(
    page.getByRole("region", { name: "The main things to check", exact: true }),
  ).toBeVisible();
  const source = page
    .getByRole("link", { name: /View source evidence for Annual deductible/ })
    .first();
  const viewerPromise = page.waitForEvent("popup");
  await source.click();
  const viewer = await viewerPromise;
  await expect(viewer.getByText("plan-a.pdf — Page 1 of 2")).toBeVisible();
  await viewer.close();
  expect(duplicateKeyWarnings).toEqual([]);
});
