import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Insurance Simplified",
  description: "Compare insurance documents side by side, with evidence.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
