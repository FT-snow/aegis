import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";

  try {
    const storedTheme = window.localStorage.getItem("aegis_theme");
    if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;

    try {
      window.localStorage.setItem("aegis_theme", nextTheme);
    } catch {
      // Keep the in-memory theme change when storage is unavailable.
    }
  }

  const actionLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      aria-label={actionLabel}
      className="button button-ghost button-sm"
      onClick={toggleTheme}
      title={actionLabel}
      type="button"
    >
      {theme === "dark" ? (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M12 2.5v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.2-1.4 1.4M6.7 17.3l-1.4 1.4m13.4 0-1.4-1.4M6.7 6.7 5.3 5.3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.7"
          />
        </svg>
      ) : (
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path
            d="M20.1 15.2A8.5 8.5 0 0 1 8.8 3.9 8.5 8.5 0 1 0 20.1 15.2Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
          />
        </svg>
      )}
    </button>
  );
}
