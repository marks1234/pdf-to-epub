export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Longest filename stem we emit; leaves room for an extension on every OS. */
const MAX_FILENAME = 120

/** Control / format characters — invisible, and illegal in some filesystems. */
const INVISIBLE = /\p{C}/gu

/** Characters Windows and macOS reject in filenames. */
const RESERVED = /[\\/:*?"<>|]/g

/**
 * Make a user-typed title safe to use as a download filename stem.
 *
 * Replaces reserved and invisible characters with spaces, collapses runs of
 * whitespace, trims leading/trailing dots and spaces (Windows silently drops
 * trailing ones) and caps the length. Returns "untitled" when nothing usable
 * is left. The extension is added by the caller.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = (name ?? "")
    .replace(INVISIBLE, " ")
    .replace(RESERVED, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .slice(0, MAX_FILENAME)
    // Slicing can re-expose a trailing dot or space.
    .replace(/[.\s]+$/, "")

  return cleaned || "untitled"
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}
