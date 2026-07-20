import * as React from "react";

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "marlen-theme";

function readPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

// Cross-instance sync: every hook instance registers here and hears the
// others' pref writes without lifting state.
const prefListeners = new Set<(pref: ThemePref) => void>();

/**
 * Three-way theme preference (light/dark/system). Persists to localStorage
 * and broadcasts through a module listener set so every hook instance
 * (header toggle, Settings row) stays in sync without lifting state.
 */
export function useTheme() {
  const [pref, setPref] = React.useState<ThemePref>(readPref);
  const [resolved, setResolved] = React.useState<"light" | "dark">(() => resolve(readPref()));

  // Apply the resolved theme to <html>, persist the pref, and broadcast it.
  React.useEffect(() => {
    const next = resolve(pref);
    setResolved(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(STORAGE_KEY, pref);
    for (const listener of prefListeners) listener(pref);
  }, [pref]);

  // While following the system, keep resolving live as the OS setting changes.
  React.useEffect(() => {
    if (pref !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = mql.matches ? "dark" : "light";
      setResolved(next);
      document.documentElement.classList.toggle("dark", next === "dark");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [pref]);

  // Cross-instance sync — another hook instance changed the pref.
  React.useEffect(() => {
    const listener = (next: ThemePref) => {
      if (next !== pref) setPref(next);
    };
    prefListeners.add(listener);
    return () => {
      prefListeners.delete(listener);
    };
  }, [pref]);

  return [pref, resolved, setPref] as const;
}
