"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem("insurance-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
      document.documentElement.dataset.theme = stored;
    }
  }, []);
  return (
    <button
      type="button"
      className="quiet"
      aria-label="Toggle color theme"
      onClick={() => {
        const dark = theme
          ? theme === "dark"
          : matchMedia("(prefers-color-scheme: dark)").matches;
        const next = dark ? "light" : "dark";
        setTheme(next);
        document.documentElement.dataset.theme = next;
        localStorage.setItem("insurance-theme", next);
      }}
    >
      <span aria-hidden="true">◐</span> Theme
    </button>
  );
}
