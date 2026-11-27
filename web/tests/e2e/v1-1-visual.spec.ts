import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("brand and appearance follow the system in light and dark", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator(".site-header img")).toHaveAttribute(
    "src",
    "/insurance-simplified-icon.png",
  );
  await expect(page.locator(".site-header__wordmark")).toBeVisible();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/insurance-simplified-icon.png",
  );
  await expect(
    page.getByRole("link", { name: "Insurance Simplified home" }),
  ).toBeVisible();
  const light = await page
    .locator("html")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.screenshot({
    path: testInfo.outputPath("m1-light.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .not.toBe(light);
  await expect
    .poll(() =>
      page
        .locator(".site-header img")
        .evaluate((img) => (img as HTMLImageElement).currentSrc),
    )
    .toContain("/insurance-simplified-icon.png");
  const background = await page
    .locator("html")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe("rgb(17, 25, 34)");
  const iconCornerAlpha = await page
    .locator(".site-header img")
    .evaluate(async (element) => {
      const img = element as HTMLImageElement;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    });
  expect(iconCornerAlpha).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("m1-dark.png"),
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(
    () => getComputedStyle(document.activeElement!).outlineStyle,
  );
  expect(focus).not.toBe("none");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("button", { name: "I have my documents" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});

test("brand and appearance keep readable text, status and focus in both system themes", async ({
  page,
}) => {
  await page.goto("/");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const ratios = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const rgb = (variable: string): number[] => {
        const value = styles.getPropertyValue(variable).trim().replace("#", "");
        return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
      };
      const luminance = (variable: string): number =>
        rgb(variable)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      const contrast = (foreground: string, background: string): number => {
        const [light, dark] = [
          luminance(foreground),
          luminance(background),
        ].sort((a, b) => b - a);
        return (light + 0.05) / (dark + 0.05);
      };
      return [
        contrast("--ink", "--bg"),
        contrast("--muted", "--surface"),
        contrast("--action", "--surface"),
        contrast("--action-ink", "--action"),
        contrast("--ok-ink", "--ok-bg"),
        contrast("--warn-ink", "--warn-bg"),
        contrast("--bad-ink", "--bad-bg"),
        contrast("--none-ink", "--none-bg"),
      ];
    });
    for (const ratio of ratios)
      expect(ratio, `${scheme} text contrast`).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement!;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        width: parseFloat(style.outlineWidth),
        color: style.outlineColor,
      };
    });
    // C2: the approved header logo is a focusable link; depending on tab
    // position the focused element may be that link or the next control.
    expect(["A", "BUTTON"]).toContain(focus.tag);
    expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.color).not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("comparison workspace remains inspectable across system themes and target widths", async ({
  page,
}) => {
  const evidenceDir = join(process.cwd(), ".omo/evidence/task-22/visual");
  mkdirSync(evidenceDir, { recursive: true });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.route("**/api/extract", (route) =>
    route.fulfill({
      json: {
        schemaVersion: "v1",
        factListVersion: "v1",
        resultFingerprint: "fp-m6-visual",
        documents: [
          { documentId: "doc-a", filename: "plan-a.pdf", pageCount: 2 },
          { documentId: "doc-b", filename: "plan-b.pdf", pageCount: 2 },
        ],
        plans: [
          {
            planId: "plan-alpha",
            name: "Alpha",
            sources: [
              { documentId: "doc-a", page: 1, quote: "ACME HEALTH PLAN A" },
            ],
          },
          {
            planId: "plan-beta",
            name: "Beta",
            sources: [
              { documentId: "doc-b", page: 1, quote: "ACME HEALTH PLAN B" },
            ],
          },
        ],
        rows: [
          {
            factName: "annual-deductible",
            verdict: "SUPPORTED",
            values: [
              {
                documentId: "doc-a",
                planId: "plan-alpha",
                display: "$250 in-network / $500 out-of-network",
                qualifiers: {},
                evidence: [
                  {
                    documentId: "doc-a",
                    page: 1,
                    quote:
                      "Annual deductible: $250 in-network / $500 out-of-network.",
                    evidenceId: "ev-visual-a-deductible",
                  },
                ],
              },
              {
                documentId: "doc-b",
                planId: "plan-beta",
                display: "$250 in-network / $500 out-of-network",
                qualifiers: {},
                evidence: [
                  {
                    documentId: "doc-b",
                    page: 1,
                    quote:
                      "Annual deductible: $250 in-network / $500 out-of-network.",
                    evidenceId: "ev-visual-b-deductible",
                  },
                ],
              },
            ],
          },
          {
            factName: "out-of-pocket-maximum",
            verdict: "SUPPORTED",
            values: [
              {
                documentId: "doc-a",
                planId: "plan-alpha",
                display: "$3,000 in-network",
                qualifiers: {},
                evidence: [
                  {
                    documentId: "doc-a",
                    page: 1,
                    quote: "Annual out-of-pocket maximum: $3,000 in-network.",
                    evidenceId: "ev-visual-a-oop",
                  },
                ],
              },
              {
                documentId: "doc-b",
                planId: "plan-beta",
                display: "$4,500 in-network",
                qualifiers: {},
                evidence: [
                  {
                    documentId: "doc-b",
                    page: 1,
                    quote: "Annual out-of-pocket maximum: $4,500 in-network.",
                    evidenceId: "ev-visual-b-oop",
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "I have my documents" }).click();
  await page.setInputFiles('input[type="file"]', [
    "tests/fixtures/plan-a.pdf",
    "tests/fixtures/plan-b.pdf",
  ]);
  await page.getByRole("button", { name: "Compare my plans" }).click();
  await page.getByRole("button", { name: "Compare policies", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Alpha" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Beta" })).toBeVisible();

  const viewports = [
    { name: "375x812", width: 375, height: 812 },
    { name: "768x1024", width: 768, height: 1024 },
    { name: "1280x900", width: 1280, height: 900 },
    { name: "narrow-laptop-1024x768", width: 1024, height: 768 },
  ];
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await expect(
        page.getByRole("columnheader", { name: "Alpha" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Beta" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Annual deductible/ }).first(),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: join(evidenceDir, `${theme}-${viewport.name}.png`),
        fullPage: true,
      });
    }
  }
  expect(browserErrors).toEqual([]);
});
