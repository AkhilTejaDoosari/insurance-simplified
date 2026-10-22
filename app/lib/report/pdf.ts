import type { RegisteredComparisonTable } from "@/app/lib/extraction/types";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { organizeRows, sanitizeGroups } from "@/app/lib/extraction/presentation-groups";
import { verifyLabelFor, buildVerifyItems } from "@/app/lib/extraction/verify-items";
import { getPlanDisplayName } from "@/app/lib/extraction/plan-names";

type ReportInput = {
  readonly table: RegisteredComparisonTable;
  readonly userContext: Readonly<Record<string, string>>;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 42;
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const INK = rgb(0.11, 0.16, 0.2);
const MUTED = rgb(0.35, 0.4, 0.44);

function printable(text: string): string {
  return text
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of printable(text).split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    for (const letter of word) {
      if (font.widthOfTextAtSize(current + letter, size) > width && current) {
        lines.push(current);
        current = "";
      }
      current += letter;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function buildReportPdf(input: ReportInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(input.table.documents.length === 1 ? "Insurance document summary" : "Insurance plan comparison");
  pdf.setAuthor("Insurance Simplified");
  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };
  const write = (
    text: string,
    options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {},
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.45;
    for (const line of wrap(text, font, size, TEXT_WIDTH - indent)) {
      if (y < MARGIN + 30) addPage();
      page.drawText(line, { x: MARGIN + indent, y, size, font, color: options.color ?? INK });
      y -= lineHeight;
    }
    y -= options.gap ?? 3;
  };
  const writeValue = (documentId: string, row: RegisteredComparisonTable["rows"][number], indent = 0) => {
    const document = input.table.documents.find((doc) => doc.documentId === documentId);
    if (!document) return;
    const values = row.values.filter((value) => value.documentId === documentId);
    const label = getPlanDisplayName({ filename: document.filename }).name;
    write(label, { font: bold, size: 9, indent });
    if (values.length === 0) {
      write("Not stated in this document.", { color: MUTED, indent, gap: 8 });
      return;
    }
    for (const value of values) {
      const tier = value.qualifiers.planTier ? `${value.qualifiers.planTier}: ` : "";
      write(`${tier}${value.display}`, { indent });
      const pages = [...new Set(value.evidence.map((e) => e.page))];
      write(`Source: ${document.filename}, page ${pages.join(", ")}`, {
        indent, color: MUTED, size: 8.5, gap: 8,
      });
    }
  };

  const single = input.table.documents.length === 1;
  write(single ? "Insurance document summary" : "Insurance plan comparison", {
    font: bold, size: 19, gap: 10,
  });
  write("Based only on the supplied documents. Confirm important details with the insurer.", {
    color: MUTED, size: 9, gap: 16,
  });
  write("Source documents", { font: bold, size: 12 });
  for (const doc of input.table.documents) write(doc.filename, { size: 9 });
  y -= 8;
  const context = Object.entries(input.userContext).filter(([, value]) => value.trim());
  if (context.length > 0) {
    write("Context supplied", { font: bold, size: 12 });
    for (const [key, value] of context) write(`${key}: ${value}`, { size: 9 });
    y -= 8;
  }

  const groups = organizeRows(input.table.rows, sanitizeGroups(
    input.table.presentationGroups ? { groups: input.table.presentationGroups } : null,
    input.table.rows,
  ));
  for (const group of groups) {
    if (y < MARGIN + 100) addPage();
    write(group.section.title, { font: bold, size: 13, gap: 8 });
    for (const row of group.rows) {
      if (y < MARGIN + 95) addPage();
      write(`${verifyLabelFor(row.factName)}${row.verdict !== "SUPPORTED" && row.verdict !== "NOT STATED" ? ` - ${row.verdict}` : ""}`, {
        font: bold, size: 10.5, gap: 4,
      });
      if (input.table.documents.length === 2) {
        const left = input.table.documents[0];
        const right = input.table.documents[1];
        const start = y;
        writeValue(left.documentId, row);
        const leftEnd = y;
        y = start;
        const offset = TEXT_WIDTH / 2 + 12;
        const saved = page;
        const startWritingRight = () => {
          if (page !== saved) return false;
          return true;
        };
        if (startWritingRight()) {
          const rightValues = row.values.filter((v) => v.documentId === right.documentId);
          write(getPlanDisplayName({ filename: right.filename }).name, { font: bold, size: 9, indent: offset });
          if (rightValues.length === 0) write("Not stated in this document.", { color: MUTED, indent: offset, gap: 8 });
          for (const value of rightValues) {
            write(`${value.qualifiers.planTier ? `${value.qualifiers.planTier}: ` : ""}${value.display}`, { indent: offset });
            write(`Source: ${right.filename}, page ${[...new Set(value.evidence.map((e) => e.page))].join(", ")}`, {
              indent: offset, color: MUTED, size: 8.5, gap: 8,
            });
          }
          y = Math.min(y, leftEnd);
        } else {
          y = leftEnd;
          writeValue(right.documentId, row);
        }
      } else {
        for (const doc of input.table.documents) writeValue(doc.documentId, row, 12);
      }
      y -= 7;
    }
  }

  const questions = buildVerifyItems(input.table.rows, input.table.documents,
    (id) => getPlanDisplayName({ filename: input.table.documents.find((d) => d.documentId === id)?.filename ?? id }).name);
  if (questions.length > 0) {
    if (y < MARGIN + 95) addPage();
    write("Verify before enrolling", { font: bold, size: 13, gap: 8 });
    for (const item of questions) {
      write(item.text, { size: 9 });
      if (item.citation) {
        const source = input.table.documents.find((doc) => doc.documentId === item.citation?.documentId);
        if (source) write(`Source: ${source.filename}, page ${item.citation.page}`, { color: MUTED, size: 8.5 });
      }
    }
  }
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => sheet.drawText(`Insurance Simplified  |  ${index + 1} / ${pages.length}`, {
    x: MARGIN, y: 24, size: 8, font: regular, color: MUTED,
  }));
  return pdf.save();
}
