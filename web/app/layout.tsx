import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "@/app/components/SiteHeader";

export const metadata: Metadata = {
  title: "Insurance Simplified",
  description:
    "Understand insurance documents or compare plans with source evidence.",
  icons: { icon: "/insurance-simplified-icon.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head></head>
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
