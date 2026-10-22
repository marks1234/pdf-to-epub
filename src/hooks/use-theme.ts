import { useCallback, useEffect, useState } from "react"

export type Theme = "system" | "light" | "dark"

/** localStorage key holding the user's theme choice. */
export const THEME_KEY = "pdf2epub.theme"

/** Cycle order for the header toggle. */
const ORDER: readonly Theme[] = ["system", "light", "dark"]

const DARK_QUERY = "(prefers-color-scheme: dark)"

function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === "light" || raw === "dark" || raw === "system") return raw
  } catch {
    // Storage blocked (private mode / embedded) — fall back to system.
  }
  return "system"
}

function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Non-critical: the choice still applies for this session.
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY).matches
    : false
}

/**
 * Three-state theme (system / light / dark) persisted to localStorage.
 *
 * "system" follows `prefers-color-scheme` live. The resolved value drives the
 * `.dark` class on <html>, which is what the token block in index.css keys off.
 * index.html applies the same class before first paint to avoid a flash.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    setSystemDark(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const isDark = theme === "dark" || (theme === "system" && systemDark)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", isDark)
    // Keeps native form controls and scrollbars in step with the tokens.
    root.style.colorScheme = isDark ? "dark" : "light"
  }, [isDark])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    writeTheme(next)
  }, [])

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length]
      writeTheme(next)
      return next
    })
  }, [])

  return { theme, isDark, setTheme, cycleTheme }
}
