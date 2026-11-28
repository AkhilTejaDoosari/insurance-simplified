"use client";

import { usePathname } from "next/navigation";
import HeaderBrandLink from "@/app/components/HeaderBrandLink";

/** The previous screens' header (/view). The V2 screens at / and /demo draw their own. */
export default function SiteHeader() {
  const pathname = usePathname();
  // "/" and /demo draw the V2 header themselves; /view keeps this one.
  if (pathname === "/" || pathname === "/demo" || pathname?.startsWith("/demo/")) return null;
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <HeaderBrandLink />
        <div className="topright">
          <span className="pill">Document-first. Evidence-led.</span>
        </div>
      </div>
    </header>
  );
}
