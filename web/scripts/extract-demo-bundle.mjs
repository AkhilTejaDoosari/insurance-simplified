// Copies the BUNDLE embedded in the owner-approved demo
// (docs/v2/demo/insurance-simplified-v2-demo.html) into the web app, unchanged:
//   app/demo/data/demo-data.json  { CAT, DOCS, FACTS, PLANS }  (read by the /demo adapter)
//   app/demo/data/demo-pdfs.json  { <docId>: <base64 PDF> }    (served by /demo/pdf/<docId>)
// Every plan, value and PDF in the bundle is invented for the demo.
// Run from web/: node scripts/extract-demo-bundle.mjs
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync(new URL("../../docs/v2/demo/insurance-simplified-v2-demo.html", import.meta.url), "utf8");
const match = html.match(/const BUNDLE=(\{.*?\});\nconst \{CAT,DOCS,FACTS,PLANS\}=BUNDLE\.data;/s);
if (!match) throw new Error("BUNDLE not found in the demo HTML");
const bundle = JSON.parse(match[1]);
const out = (name, value) =>
  writeFileSync(new URL(`../app/demo/data/${name}`, import.meta.url), JSON.stringify(value, null, 1) + "\n");
out("demo-data.json", bundle.data);
out("demo-pdfs.json", bundle.pdfs);
console.log("demo bundle:", Object.keys(bundle.data).join(", "), "· pdfs:", Object.keys(bundle.pdfs).join(", "));
