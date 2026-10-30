import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
// Components compile with the classic JSX runtime and read `React` at
// render time; provide it (node test env has no such global).
(globalThis as Record<string, unknown>).React ??= React;

import Layout from "@/app/layout";

/** C2: the approved header logo must be an accessible navigation link to the
 *  Welcome/Intake journey (`/`). */
describe("header logo navigation", () => {
  it("renders the brand as a link with href=\" / \" and an accessible label", () => {
    const html = renderToStaticMarkup(React.createElement(Layout, { children: null }));
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="Insurance Simplified home"');
    expect(html).toContain("site-header__brand");
  });
});
