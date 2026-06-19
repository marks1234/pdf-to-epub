import { useCallback, useState } from "react"

/** How many remembered names to keep per field. */
const CAP = 12

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []
  } catch {
    return []
  }
}

function write(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values))
  } catch {
    // Storage full or unavailable — fail silently; names are non-critical.
  }
}

/**
 * Remembered free-text values (e.g. titles or authors) backed by localStorage,
 * most-recent first. Returns the list plus `remember` / `forget` helpers.
 */
export function useNameMemory(key: string) {
  const [values, setValues] = useState<string[]>(() => read(key))

  const remember = useCallback(
    (raw: string) => {
      const value = raw.trim()
      if (!value) return
      setValues((prev) => {
        const next = [value, ...prev.filter((v) => v !== value)].slice(0, CAP)
        write(key, next)
        return next
      })
    },
    [key],
  )

  const forget = useCallback(
    (value: string) => {
      setValues((prev) => {
        const next = prev.filter((v) => v !== value)
        write(key, next)
        return next
      })
    },
    [key],
  )

  return { values, remember, forget }
}
