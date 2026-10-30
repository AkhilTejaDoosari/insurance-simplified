import type { Metadata } from "next";
import "./globals.css";
import HeaderBrandLink from "@/app/components/HeaderBrandLink";
import ThemeToggle from "@/app/components/ThemeToggle";

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
        <header className="site-header">
          <div className="site-header__inner">
            <HeaderBrandLink />
            <div className="topright">
              <span className="pill">Document-first. Evidence-led.</span>
              <ThemeToggle />
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
