// Generates sample English PDFs with KNOWN values for tests/e2e and manual
// validation. Recorded fixture truth is in tests/fixtures/README.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

const OUT = new URL("../tests/fixtures/", import.meta.url);

async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const body of pages) {
    const page = doc.addPage([612, 792]);
    const lines = body.split("\n");
    let y = 750;
    for (const line of lines) {
      page.drawText(line.slice(0, 95), { x: 50, y, size: 11, font });
      y -= 16;
    }
  }
  return doc.save();
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // Plan A — agrees with B on deductible, conflicts on emergency copay.
  const planA = await makePdf([
    [
      "ACME HEALTH PLAN A - SUMMARY OF BENEFITS",
      "Annual deductible: $250 in-network / $500 out-of-network.",
      "Annual out-of-pocket maximum: $3,000 in-network.",
      "Emergency care copay: $100, waived if admitted.",
    ].join("\n"),
    [
      "Prescription coverage: covered at a reasonable cost.",
      "International student eligibility: must hold a valid F-1 visa.",
      "Network: Acme Preferred Provider Network applies.",
    ].join("\n"),
  ]);

  // Plan B — conflicts with A on emergency copay; deductible matches.
  const planB = await makePdf([
    [
      "ACME HEALTH PLAN B - SUMMARY OF BENEFITS",
      "Annual deductible: $250 in-network / $500 out-of-network.",
      "Annual out-of-pocket maximum: $4,500 in-network.",
      "Emergency care copay: $250 per visit.",
    ].join("\n"),
    [
      "Pre-existing conditions: covered after a 6-month waiting period.",
      "Network: Acme Preferred Provider Network applies.",
    ].join("\n"),
  ]);

  writeFileSync(new URL("plan-a.pdf", OUT), planA);
  writeFileSync(new URL("plan-b.pdf", OUT), planB);
  console.log("Wrote plan-a.pdf and plan-b.pdf to tests/fixtures/");
}

void main();
