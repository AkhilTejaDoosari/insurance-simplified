// Single-page rendering for citations: copy exactly one page out of an
// uploaded PDF so the viewer can show the actual cited source page.
// Returns null when the file cannot be re-rendered (e.g. encrypted or
// restricted PDFs that pdf-lib cannot open, or corrupt bytes) so callers
// fall back explicitly instead of serving a wrong page.

import { PDFDocument } from "pdf-lib";

export async function trySinglePage(
  bytes: Uint8Array,
  page: number
): Promise<Uint8Array | null> {
  try {
    const src = await PDFDocument.load(bytes);
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(src, [page - 1]);
    out.addPage(copied);
    return await out.save();
  } catch {
    return null;
  }
}
