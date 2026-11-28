// The invented demo PDFs (docs/v2/demo), served for the /demo viewer. They are
// stored as base64 in JSON because real or derived PDFs never live in git
// (scripts/check-private-data.sh); these were generated for the demo.
import pdfs from "../../data/demo-pdfs.json";

const PDFS = pdfs as Record<string, string>;

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(PDFS).map((doc) => ({ doc }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const b64 = Object.hasOwn(PDFS, doc) ? PDFS[doc] : undefined;
  if (!b64) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(b64, "base64"), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc}-demo.pdf"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
