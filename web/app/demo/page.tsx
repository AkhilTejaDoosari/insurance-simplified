import type { Metadata } from "next";
import DemoApp from "./components/DemoApp";

export const metadata: Metadata = {
  title: "Demo data — Insurance Simplified",
  description: "Interactive demo of Insurance Simplified V2 with invented plans and demo PDFs.",
  robots: { index: false },
};

/** /demo: the owner-approved V2 demo (docs/v2/demo), fed by its own invented data. */
export default function DemoPage() {
  return <DemoApp />;
}
