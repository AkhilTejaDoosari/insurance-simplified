import { expect, test } from "@playwright/test";

test("upload → document reading → evidence → chat → export (quickstart Flows 1–3, 6)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();

  // The deterministic fixture has document evidence but no proven plan IDs.
  // C6: retain it in the document reading, not as a confirmed plan benefit.
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  // No plan identity is verified in this fixture. The source value remains in
  // the individual reading with an applicability warning and its exact source.
  const deductibleRow = page
    .locator(".adaptiveResults .adaptiveFacts article")
    .filter({
      has: page.getByRole("heading", {
        name: "Annual deductible",
        exact: true,
      }),
    });
  await expect(deductibleRow.locator(".cell-value")).toHaveCount(1);
  await expect(deductibleRow).toContainText("Unverified applicability");
  await expect(page.getByRole("button", { name: "Compare policies", exact: true })).toBeDisabled();
  // Each value is a direct source link (one click → viewer). Labels name the
  // fact, file, and page; the LLM engine may split or combine the display
  // text, so match the stable label rather than the figure.
  const valueLink = deductibleRow.locator(".cell-value").first();
  await expect(valueLink).toBeVisible();
  // Each value links to its OWN evidence: document, page, opaque evidence ID.
  // The URL carries the document's real filename (Phase B: filenames stay
  // document metadata; documentId selects the file).
  await expect(valueLink).toHaveAttribute(
    "href",
    /\/view\/sess-[^/]+\/doc-1\/plan-a\.pdf\?page=1&evidence=ev-[0-9a-f]{16}$/,
  );
  const [viewer] = await Promise.all([
    page.waitForEvent("popup"),
    valueLink.click(),
  ]);
  await expect(viewer.getByText("Page 1 of 2")).toBeVisible();
  await expect(viewer.getByText(/Annual deductible/).first()).toBeVisible();
  // The viewer renders the ACTUAL cited source page (PDF.js canvas, not an
  // iframe of a rewritten file), with the full original reachable separately.
  await expect(viewer.locator("canvas").first()).toBeVisible();
  const evidenceViewer = viewer.getByTestId("pdf-evidence-viewer");
  await expect(evidenceViewer).toBeAttached();
  await viewer.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="pdf-evidence-viewer"][data-evidence-state="unique"]',
      ) !== null,
  );
  // The evidence highlight overlays the rendered PDF page itself.
  await expect(viewer.getByTestId("evidence-highlight").first()).toBeVisible();
  await expect(
    viewer.getByRole("link", { name: "Open full original PDF" }),
  ).toHaveAttribute("href", /\/api\/document\/sess-[^/]+\/doc-1\/.+$/);
  // An invalid citation page fails explicitly instead of showing another page.
  await viewer.goto(viewer.url().replace(/page=1(&|$)/, "page=99$1"));
  await expect(viewer.getByText(/does not exist/)).toBeVisible();
  // The cited passage highlight sits on the rendered PDF page.
  await viewer.goto(viewer.url().replace(/page=99(&|$)/, "page=1$1"));
  await viewer.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="pdf-evidence-viewer"][data-evidence-state="unique"]',
      ) !== null,
  );
  await expect(viewer.getByTestId("evidence-highlight").first()).toBeVisible();
  // A tampered/unknown evidence ID fails explicitly instead of highlighting
  // a passage it did not cite.
  await viewer.goto(
    viewer
      .url()
      .replace(/evidence=ev-[0-9a-f]{16}/, "evidence=ev-0000000000000000"),
  );
  await expect(
    viewer.getByText(/evidence reference does not match/),
  ).toBeVisible();
  await expect(viewer.getByTestId("evidence-highlight")).toHaveCount(0);

  // Flow 3: cited answer, then explicit refusal.
  await page
    .getByRole("button", { name: "Ask a question", exact: true })
    .first()
    .click();
  await page.getByLabel("Your question").fill("What is the emergency copay?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("doc-1, page 1:").first()).toBeVisible();
  await page.getByLabel("Your question").fill("Does this cover space tourism?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("no supporting evidence")).toBeVisible();

  // Flow 6: export downloads a PDF built from the validated result.
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download report/ }).click(),
  ]);
  const path = await download[0].path();
  expect(path).toBeTruthy();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
});

test("no-documents checklist flow (quickstart Flow 5)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /don't know where to start/ }).click();
  await page.getByLabel("Age", { exact: true }).fill("34");
  await page.getByRole("button", { name: "Build my checklist" }).click();
  await expect(
    page.getByRole("heading", { name: "Documents to collect" }),
  ).toBeVisible();
  await expect(page.getByText(/age-based limits.*34/)).toBeVisible();
  await page
    .getByRole("button", { name: "I have my documents — upload", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Choose PDF files/ }),
  ).toBeVisible();
});

test("one PDF explains evidenced terms in the results workspace", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible({ timeout: 20_000 });
  const deductible = page
    .locator(".adaptiveResults .adaptiveFacts article")
    .filter({
      has: page.getByRole("heading", {
        name: "Annual deductible",
        exact: true,
      }),
    });
  await expect(deductible.locator(".cell-value")).toBeVisible();
  await expect(deductible).toContainText("Unverified applicability");
});

test("two unassigned PDFs keep individual reading and document switching legible on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await expect(
    page.getByRole("heading", { name: "Know what this policy says." }),
  ).toBeVisible();
  const pageWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(pageWidth).toBeLessThanOrEqual(375);
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByLabel("Choose a document for individual reading").selectOption("doc-2");
  await expect(page.locator(".adaptiveResults")).toContainText("Unverified applicability");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
