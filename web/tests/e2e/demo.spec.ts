import { expect, test, type Page } from "@playwright/test";

/** /demo: the owner-approved V2 demo (D-038) ported to React, fed by its own invented data. */

async function toResults(page: Page) {
  await page.goto("/demo");
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await page.getByRole("button", { name: "Compare my documents" }).click();
  await page.getByRole("button", { name: "Read my documents" }).click();
  await page.getByRole("button", { name: "See results" }).click({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "In all your plans" })).toBeVisible();
}

test.describe("desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("results: counts, gauges, filter bar, same-for-all-levels, contacts", async ({ page }) => {
    await toResults(page);
    await expect(page.getByText("Showing 3 of 4 — close the sidebar or chat to see all")).toBeVisible();
    await expect(page.getByRole("img", { name: "100 percent match" })).toHaveCount(2);
    await expect(page.locator("#filterbar")).toContainText(
      "Showing must know + important: 10 of 13 benefits. Hidden: 3 good to know.",
    );
    await expect(page.getByText("Same for all 3 levels").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Email my \d+ open questions/ }).first()).toHaveAttribute(
      "href",
      /^mailto:claims@globe\.example\?subject=Question%20about%20Globe%20Student%20Care/,
    );

    await page.getByLabel("Show").selectOption("1");
    await expect(page.locator("#filterbar")).toContainText("Showing must know only: 6 of 13 benefits. Hidden: 4 important and 3 good to know.");
    await page.getByRole("button", { name: "Show everything" }).click();
    await expect(page.locator("#filterbar")).toContainText("Showing everything: 13 of 13 benefits.");
  });

  test("Esc closes the viewer, sidebar and chat; focus returns to the opener", async ({ page }) => {
    await toResults(page);

    const source = page.getByRole("button", { name: "Page 3 (printed 1)" }).first();
    await source.click();
    const viewer = page.getByRole("dialog", { name: /Globe Student Care Gold: Deductible/ });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText("Look for")).toBeVisible();
    await expect(viewer.locator("iframe")).toHaveAttribute("src", "/demo/pdf/globe#page=3");
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(source).toBeFocused();

    await page.getByRole("button", { name: "Close chat" }).click();
    const ask = page.getByRole("button", { name: "Ask about your plans" });
    await expect(ask).toBeFocused();
    await ask.click();
    await expect(page.getByRole("button", { name: "Close chat" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Close chat" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Ask about your plans" })).toBeFocused();

    const hamb = page.getByRole("button", { name: /Documents and needs/ });
    await page.getByRole("button", { name: "Close sidebar" }).focus();
    await page.keyboard.press("Escape");
    await expect(hamb).toHaveAttribute("aria-expanded", "false");
    await expect(hamb).toBeFocused();
  });

  test("chat answers from the selected plans with page links", async ({ page }) => {
    await toResults(page);
    await page.getByRole("button", { name: "What's the Gold plan's deductible?" }).click();
    await expect(page.getByText("Clarifying")).toBeVisible();
    await page.getByLabel("Your question").fill("");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Type a question first." })).toBeVisible();
    await page.getByLabel("Your question").fill("Is dental covered on Globe Gold?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Globe Student Care Gold:").last()).toBeVisible();
  });

  test("empty state, find page prompt", async ({ page }) => {
    await toResults(page);
    for (const n of ["Globe Student Care", "Campus Care", "Scholar Shield"]) await page.getByRole("checkbox", { name: n }).click();
    await expect(page.getByRole("heading", { name: "No plans selected" })).toBeVisible();

    await page.getByRole("button", { name: "Insurance Simplified home" }).click();
    await page.getByRole("button", { name: "I don't have my documents" }).click();
    await page.getByRole("button", { name: "Create my prompt" }).click();
    await expect(page.getByText("Enter your state and city, and your age.")).toBeVisible();
    await page.getByLabel("State and city").fill("Texas, Denton");
    await page.getByLabel("Age", { exact: true }).fill("27");
    await page.getByRole("button", { name: "Create my prompt" }).click();
    await expect(page.getByLabel("Your prompt")).toHaveValue(/Location: United States, Texas, Denton/);
  });

  test("demo PDFs are served; unknown ones are not", async ({ request }) => {
    const ok = await request.get("/demo/pdf/campus");
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("application/pdf");
    expect((await ok.body()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await request.get("/demo/pdf/unknown")).status()).toBe(404);
  });
});

test.describe("phone 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("sidebar and chat are full-screen sheets; two plan columns, swipe for more", async ({ page }) => {
    await toResults(page);
    await expect(page.getByText("Showing 2 of 4 at a time — swipe the table for the others")).toBeVisible();
    const body = page.getByRole("region", { name: /Comparison table/ }).first();
    const { client, scroll } = await body.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(scroll).toBeGreaterThan(client * 1.5);
    // Swiping the body moves the pinned header with it.
    await body.evaluate((el) => el.scrollBy({ left: 200 }));
    await expect
      .poll(() => body.evaluate((el) => (el.previousElementSibling as HTMLElement).scrollLeft))
      .toBe(await body.evaluate((el) => el.scrollLeft));
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(390);

    const hamb = page.getByRole("button", { name: /Documents and needs/ });
    await hamb.click();
    const sheet = page.getByRole("dialog", { name: "Documents and needs" });
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((el) => el.getBoundingClientRect().width)).toBe(390);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(hamb).toBeFocused();

    await page.getByRole("button", { name: "Ask about your plans" }).click();
    await expect(page.getByRole("dialog", { name: "Ask about your plans" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Ask about your plans" })).toBeFocused();
  });
});
