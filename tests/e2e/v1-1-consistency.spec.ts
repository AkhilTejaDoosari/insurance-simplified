import { expect, test, type Page, type Route } from "@playwright/test";
import { registered } from "./registered-fixture";

// M5 task 18: chat turns are keyed to the effective plan/tier selection.
// Late responses from a superseded selection are discarded, historical turns
// are labelled with their scope (evidence links stay intact), and scope
// errors are distinct and clear when the selection changes.

const plans = [
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
];
const tiered = (
  documentId: string,
  planId: string,
  tier: string,
  display: string,
) => ({
  documentId,
  planId,
  display,
  qualifiers: { planTier: tier },
  evidence: [{ documentId, page: 1, quote: `${tier} deductible ${display}` }],
});

const TABLE = {
  schemaVersion: "v1",
  factListVersion: "v1",
  resultFingerprint: "fp-consistency",
  documents: [
    { documentId: "doc-1", filename: "plan-a.pdf", pageCount: 1 },
    { documentId: "doc-2", filename: "plan-b.pdf", pageCount: 1 },
  ],
  presentationGroups: [{ title: "Costs", factNames: ["annual-deductible"] }],
  plans,
  rows: [
    {
      factName: "annual-deductible",
      verdict: "SUPPORTED",
      values: [
        tiered("doc-1", "plan-alpha", "Basic", "$250"),
        tiered("doc-1", "plan-alpha", "Choice", "$100"),
        tiered("doc-2", "plan-beta", "Basic", "$500"),
        tiered("doc-2", "plan-beta", "Choice", "$800"),
      ],
    },
  ],
};

async function startResults(page: Page) {
  await page.route("**/api/extract", (route) => route.fulfill({ json: registered(TABLE) }));
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Compare your policies" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ask a question", exact: true })
    .first()
    .click();
}

function answerFor(body: {
  selection?: { planIds?: string[]; tiers?: Record<string, unknown> };
}) {
  return {
    schemaVersion: "v1",
    kind: "answer",
    answerText: `scope ${JSON.stringify({
      planIds: body.selection?.planIds ?? null,
      tiers: body.selection?.tiers ?? null,
    })}`,
    citations: [],
  };
}

test("stale chat: a late answer from a superseded selection never lands", async ({
  page,
}) => {
  const chatBodies: unknown[] = [];
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let first = true;
  await page.route("**/api/chat", async (route: Route) => {
    const body = route.request().postDataJSON() as {
      selection?: {
        resultFingerprint: string;
        planIds: string[];
        tiers: Record<string, unknown>;
        selectionKey: string;
      };
    };
    chatBodies.push(body);
    if (first) {
      first = false;
      await gate; // request A waits until the test releases it
    }
    try {
      await route.fulfill({ json: answerFor(body) });
    } catch {
      // The client aborted this request (selection changed) — nothing to serve.
    }
  });

  await startResults(page);
  const question = page.getByLabel("Your question");
  const ask = page.getByRole("button", { name: "Ask", exact: true });
  await question.fill("What is the deductible?");
  await ask.click(); // request A hangs

  // Change the selection while A is in flight: the tier switch invalidates A.
  await page.getByLabel("Tier shown for Alpha").selectOption("Choice");
  releaseGate();
  // A's late answer must be discarded: no answer text, input freed, no error.
  await expect(page.getByText("scope {")).toHaveCount(0);
  await expect(ask).toBeEnabled();

  // A fresh ask under the new selection answers normally.
  await question.fill("What is the deductible?");
  await ask.click();
  await expect(page.getByText(/scope \{/).first()).toBeVisible();
  expect(chatBodies).toHaveLength(2);
  // The selection payload reached the server: opaque fingerprint, plans, tiers.
  const sent = chatBodies[1] as {
    selection?: {
      resultFingerprint: string;
      planIds: string[];
      tiers: Record<string, unknown>;
      selectionKey: string;
    };
  };
  expect(sent.selection?.resultFingerprint).toBe("fp-consistency");
  expect(sent.selection?.planIds).toEqual(["plan-alpha", "plan-beta"]);
  expect(sent.selection?.tiers?.["plan-alpha"]).toBe("Choice");
  expect(sent.selection?.selectionKey?.length).toBeGreaterThan(0);
});

test("historical turns keep their scope and evidence links when the selection changes", async ({
  page,
}) => {
  await startResults(page);

  const citation = {
    documentId: "doc-1",
    page: 1,
    quote: "Plan name: Alpha",
    evidenceId: "ev-hist-1",
  };
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "v1",
        kind: "answer",
        answerText: "Alpha Basic deductible is $250.",
        citations: [citation],
      },
    }),
  );
  const question = page.getByLabel("Your question");
  await question.fill("What is the deductible?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Alpha Basic deductible is $250.")).toBeVisible();

  // Selection changes: the retained turn is labelled with its former scope but
  // keeps its evidence citation (same URL semantics as live turns).
  await page.getByLabel("Tier shown for Alpha").selectOption("Choice");
  await expect(page.getByText(/Answered earlier for:/)).toBeVisible();
  const link = page.getByRole("link", { name: "page 1", exact: true }).first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    /\/view\/sess-[^/]+\/doc-1\/plan-a\.pdf\?page=1&evidence=ev-hist-1$/,
  );
});

test("stale schema errors are distinct messages that clear on selection change", async ({
  page,
}) => {
  await startResults(page);
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "STATE_CONFLICT",
          message: "Selection is stale: a newer comparison result exists.",
        },
      }),
    }),
  );
  await page.getByLabel("Your question").fill("What is the deductible?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByText("Selection is stale: a newer comparison result exists."),
  ).toBeVisible();

  // A new selection clears the scope-scoped error without a request.
  await page.getByLabel("Tier shown for Alpha").selectOption("Choice");
  await expect(page.getByText("Selection is stale")).toHaveCount(0);
});
