// Self-hosted through next/font (design.md "Type"): the files ship from the
// installed @fontsource packages, so the build makes no font network request.
import localFont from "next/font/local";

export const displayFont = localFont({
  src: "../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-bricolage",
  display: "swap",
  fallback: ["Avenir Next", "Segoe UI", "system-ui", "sans-serif"],
});

export const bodyFont = localFont({
  src: [
    { path: "../../node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "../../node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-atkinson",
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "-apple-system", "sans-serif"],
});
