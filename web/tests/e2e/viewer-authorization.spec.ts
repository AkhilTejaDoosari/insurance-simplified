// A citation link opened without this session's capability (a different
// browser, a shared/leaked URL) reveals no filename, page count, cited passage
// or document link. The owning browser still opens it normally.
import { expect, test } from "@playwright/test";

test("citation link without the session capability reveals nothing", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', "tests/fixtures/plan-a.pdf");
  await page.getByRole("button", { name: "Understand my document" }).click();
  const link = page.locator(".adaptiveResults .cell-value").first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = (await link.getAttribute("href"))!;
  expect(href).toMatch(/\/view\/sess-[^/]+\/doc-1\/plan-a\.pdf\?page=\d+&evidence=ev-[0-9a-f]{16}$/);

  const stranger = await browser.newContext();
  const other = await stranger.newPage();
  await other.goto(href);
  await expect(other.getByRole("heading", { name: "Citation unavailable" })).toBeVisible();
  const body = await other.locator("body").innerText();
  expect(body).not.toContain("plan-a.pdf");
  expect(body).not.toMatch(/Page \d+ of \d+/);
  expect(await other.title()).toBe("Citation");
  expect(await other.locator('a[href*="/api/document/"]').count()).toBe(0);
  const pdf = await other.request.get(href.replace("/view/", "/api/document/").replace(/\?.*$/, ""));
  expect(pdf.status()).toBe(401);
  await stranger.close();

  // The owning browser still sees the document.
  await page.goto(href);
  await expect(page.getByText(/plan-a\.pdf — Page \d+ of \d+/)).toBeVisible();
});
