// Generates the SYNTHETIC demo PDFs used for a local walkthrough:
//
//   npm run gen-demo-fixtures   (or: npx tsx scripts/gen-demo-fixtures.ts)
//
// Two invented plans, each with a proven plan-name line, cost lines and an
// exclusion section, so the deterministic reader proves the plan and the
// exclusion inventory is complete. Written to real-fixtures/demo/ (git-ignored;
// never commit generated documents). Contains no real insurer, plan or
// policyholder data.
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

const OUT = new URL("../real-fixtures/demo/", import.meta.url);

async function makePdf(pages: string[][], file: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const body of pages) {
    const page = doc.addPage([612, 792]);
    let y = 750;
    for (const line of body) {
      const heading = line.startsWith("# ");
      const text = heading ? line.slice(2) : line;
      page.drawText(text.slice(0, 95), {
        x: 50,
        y,
        size: heading ? 13 : 11,
        font: heading ? bold : font,
      });
      y -= heading ? 22 : 16;
    }
  }
  writeFileSync(new URL(file, OUT), await doc.save());
}

function planPages(input: {
  plan: string;
  outOfPocket: string;
  emergency: string;
  officeVisit: string;
  exclusions: string[];
  prescription: string;
  visa: string;
  claimDays: string;
}): string[][] {
  return [
    [
      "# Summary of Benefits and Coverage",
      `Plan name: ${input.plan}`,
      "Plan year: 2026",
      "Annual deductible: $500 in-network / $1,500 out-of-network.",
      `Annual out-of-pocket maximum: ${input.outOfPocket} in-network.`,
      `Emergency care copay: ${input.emergency} per visit, waived if admitted.`,
      `Office visit copay: ${input.officeVisit}`,
    ],
    [
      "# Exclusions",
      ...input.exclusions.map((item) => `- ${item}`),
      "# Covered Services",
      `Prescription drugs: ${input.prescription}`,
    ],
    [
      "# Eligibility and Network",
      `International student eligibility: must hold a valid ${input.visa}.`,
      "Network: Evergreen Preferred Provider Network applies.",
      `Claims must be filed within ${input.claimDays} days of the date of service.`,
    ],
  ];
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await makePdf(
    planPages({
      plan: "Evergreen Health Gold",
      outOfPocket: "$4,000",
      emergency: "$150",
      officeVisit: "$25 primary care / $45 specialist",
      exclusions: ["Cosmetic procedures", "Long-term care services", "Routine foot care"],
      prescription: "$15 generic / $45 brand copay",
      visa: "F-1 visa",
      claimDays: "90",
    }),
    "demo-gold.pdf",
  );
  await makePdf(
    planPages({
      plan: "Evergreen Health Silver",
      outOfPocket: "$6,500",
      emergency: "$350",
      officeVisit: "$40 primary care / $70 specialist",
      exclusions: ["Cosmetic procedures", "Long-term care services", "Weight-loss surgery"],
      prescription: "$20 generic / $60 brand copay",
      visa: "F-1 or J-1 visa",
      claimDays: "60",
    }),
    "demo-silver.pdf",
  );
  console.log("wrote real-fixtures/demo/demo-gold.pdf and demo-silver.pdf");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "generation failed");
  process.exitCode = 1;
});
