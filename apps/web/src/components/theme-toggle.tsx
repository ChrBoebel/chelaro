"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "finance-os-theme";
const DARK_THEME_QUERY = "(prefers-color-scheme: dark)";
const THEME_CHANGE_EVENT = "finance-os-theme-change";

function isTheme(value: string | null | undefined): value is Theme {
  return value === "dark" || value === "light";
}

function readStoredTheme(): Theme | null {
  try {
    const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(theme) ? theme : null;
  } catch {
    return null;
  }
}

function readSystemTheme(): Theme {
  return typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_THEME_QUERY).matches
    ? "dark"
    : "light";
}

function readCurrentTheme(): Theme {
  const documentTheme = document.documentElement.dataset.theme;
  return isTheme(documentTheme)
    ? documentTheme
    : (readStoredTheme() ?? readSystemTheme());
}

function applyTheme(theme: Theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The selected theme still applies for this session if storage is unavailable.
    }
  }
}

function subscribeToTheme(onThemeChange: () => void) {
  const mediaQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia(DARK_THEME_QUERY)
      : null;

  applyTheme(readCurrentTheme());

  const handleSystemThemeChange = (event: MediaQueryListEvent) => {
    if (readStoredTheme() === null) {
      applyTheme(event.matches ? "dark" : "light");
      onThemeChange();
    }
  };

  const handleStoredThemeChange = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) {
      return;
    }

    applyTheme(isTheme(event.newValue) ? event.newValue : readSystemTheme());
    onThemeChange();
  };

  mediaQuery?.addEventListener("change", handleSystemThemeChange);
  window.addEventListener("storage", handleStoredThemeChange);
  window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);

  return () => {
    mediaQuery?.removeEventListener("change", handleSystemThemeChange);
    window.removeEventListener("storage", handleStoredThemeChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  };
}

function getServerTheme(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    readCurrentTheme,
    getServerTheme,
  );

  const isDark = theme === "dark";
  const label = isDark
    ? "Hellen Modus aktivieren"
    : "Dunklen Modus aktivieren";

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, true);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  return (
    <button
      type="button"
      aria-label={label}
      className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-paper text-ink shadow-[0_1px_2px_rgba(20,25,20,0.07)] transition-[border-color,background-color,color] duration-150 hover:border-muted-strong hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      title={label}
      onClick={toggleTheme}
    >
      <span aria-hidden="true" className="relative block size-5">
        <SunIcon
          className={`absolute inset-0 transition-[opacity,transform] duration-200 ${
            isDark
              ? "rotate-0 scale-100 opacity-100"
              : "rotate-90 scale-75 opacity-0"
          }`}
        />
        <MoonIcon
          className={`absolute inset-0 transition-[opacity,transform] duration-200 ${
            isDark
              ? "-rotate-90 scale-75 opacity-0"
              : "rotate-0 scale-100 opacity-100"
          }`}
        />
      </span>
    </button>
  );
}

function SunIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.25v2M12 19.75v2M2.25 12h2M19.75 12h2M5.1 5.1l1.42 1.42M17.48 17.48l1.42 1.42M18.9 5.1l-1.42 1.42M6.52 17.48 5.1 18.9" />
    </svg>
  );
}

function MoonIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8a8.5 8.5 0 1 0 11.3 11.3Z" />
    </svg>
  );
}
