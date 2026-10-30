import { expect, test } from "@playwright/test";
import { registered } from "./registered-fixture";

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
    { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 2 },
  ],
  presentationGroups: [
    { title: "Deductible choices", factNames: ["annual-deductible"] },
    { title: "Emergency care", factNames: ["emergency-care"] },
  ],
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        {
          documentId: "doc-1",
          display: "$250 in-network / $500 out-of-network",
          qualifiers: {},
          evidence: [
            { documentId: "doc-1", page: 1, quote: "Annual deductible: $250" },
          ],
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
          evidence: [
            {
              documentId: "doc-2",
              page: 2,
              quote: "Emergency medical evacuation",
            },
          ],
        },
      ],
    },
  ],
};

test("multi-tier PDF keeps tier selection in the individual reading", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await page.route("**/api/extract", (route) =>
    route.fulfill({ json: registered(TIERED_TABLE) }),
  );
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

  await page.getByLabel("Choose a document for individual reading").selectOption("doc-2");
  await expect(page.getByRole("table")).toHaveCount(0);
  const evidence = page.locator(".adaptiveResults .adaptiveFacts");
  // Legacy uploads have no verifiable plan identity. Understand mode stays a
  // document-specific reading and does not create comparison columns.
  await expect(page.getByRole("button", { name: "Compare policies", exact: true })).toBeDisabled();

  // All-tiers mode keeps each tier attributed in the individual reading.
  await expect(evidence.getByText("Tier: Lite")).toBeVisible();
  await expect(evidence.getByText("Tier: Plus")).toBeVisible();
  await expect(evidence.getByText("Tier: Platinum")).toBeVisible();

  // Values are direct source links (accessible name carries fact/file/page;
  // visible text is the figure, which the mocked table fixes).
  const valueLink = (text: string) =>
    evidence.locator(".cell-value").filter({ hasText: text });
  await expect(valueLink("$0 to $25,000")).toBeVisible();
  await expect(valueLink("$0 to $2,500")).toHaveCount(2);

  await expect(
    evidence.locator(".cell-value").filter({ hasText: /evacuation/ }),
  ).toHaveCount(1);

  // Picking one tier collapses the group to a single column. The tier control
  // is labelled by the unconfirmed plan title distinguished by upload position.
  const picker = page.getByLabel(
    "Tier shown for Plan name unconfirmed (upload 2)",
  );
  await expect(picker).toHaveValue("");
  await picker.selectOption("Platinum");
  await expect(evidence.getByText("Tier: Platinum")).toBeVisible();
  await expect(evidence.getByText("Tier: Lite")).toHaveCount(0);
  await expect(evidence.getByText("Tier: Plus")).toHaveCount(0);
  await expect(valueLink("$0 to $2,500")).toHaveCount(0);
  await expect(valueLink("$0 to $25,000")).toBeVisible();

  await picker.selectOption("");
  await expect(evidence.getByText("Tier: Lite")).toBeVisible();

  // The tier value links straight to its own citation (mocked extract output
  // carries no evidence IDs, so links carry the page without an evidence ID),
  // with no duplicate-key warnings (one document now yields several values).
  const tierValue = valueLink("$0 to $25,000");
  await expect(tierValue).toHaveAttribute(
    "href",
    /\/view\/sess-[^/]+\/doc-2\/.+\?page=1&evidence=ev-[0-9a-f]{16}/,
  );
  const [viewer] = await Promise.all([
    page.waitForEvent("popup"),
    tierValue.click(),
  ]);
  // The viewer resolves against the real uploaded session (only /api/extract
  // is mocked), so it shows the actual plan-b.pdf page.
  await expect(viewer.getByText(/evidence reference does not match/)).toBeVisible();
  await expect(viewer.getByTestId("evidence-highlight")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
