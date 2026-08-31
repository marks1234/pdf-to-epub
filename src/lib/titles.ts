/**
 * Pure title-shaping helpers.
 *
 * These live apart from `pdf-to-epub.ts` on purpose: the UI needs them on every
 * queue row, and importing anything from `pdf-to-epub.ts` would drag pdf.js,
 * jepub and JSZip into the main bundle — the very thing the lazy worker import
 * in `use-converter.ts` exists to avoid. `pdf-to-epub.ts` re-exports
 * `chapterTitle` so the conversion pipeline still owns it publicly.
 */

import { extractNumber } from "@/lib/sequence"

/** Derive a chapter title from a file name, e.g. "Chapter 22 (2,509 words).pdf" → "Chapter 22". */
export function chapterTitle(filename: string): string {
  const { num, label } = extractNumber(filename)
  if (label && num !== null) return `${label} ${num}`

  const base = filename.replace(/\.[^.]+$/, "")
  const cleaned = base
    .replace(/\s*\([^)]*\)\s*/g, " ") // drop "(2,509 words)"-style notes
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || base
}

/** The pattern the bulk-rename dialog opens with. */
export const DEFAULT_RENAME_PATTERN = "Chapter {n}"

/** Placeholders `expandTitlePattern` understands; `{n}` and `{num}` only. */
const TOKEN_RE = /\{(n|num)\}/g

/**
 * Expand a bulk-rename pattern for one queue row.
 *
 * - `{n}` — the row's 1-based position in the set being renamed.
 * - `{num}` — the number found in the file name ("Chapter 07.pdf" → 7), falling
 *   back to the position when the name carries no number.
 *
 * Anything else in the pattern is literal, so "Vol 2 — {num}" works as typed.
 * Returns the trimmed result; an empty pattern yields an empty string and the
 * caller decides what that means.
 */
export function expandTitlePattern(
  pattern: string,
  position: number,
  filename: string,
): string {
  const { num } = extractNumber(filename)
  return pattern
    .replace(TOKEN_RE, (_match, token: string) =>
      String(token === "num" ? (num ?? position) : position),
    )
    .trim()
}

/**
 * The `dc:title` that makes Kindle group sideloaded volumes of one series.
 *
 * Kindle ignores series metadata for sideloads and files books by title-sort, so
 * folding the series and a zero-padded index into the title is the only thing
 * that keeps "Quest Academy 03 — Rise of the Guild" next to volumes 1 and 2.
 * The download filename deliberately keeps the plain title.
 */
export function kindleSeriesTitle(
  series: string,
  index: number,
  title: string,
): string {
  const padded = String(Math.max(1, Math.floor(index))).padStart(2, "0")
  return `${series.trim()} ${padded} — ${title.trim()}`
}
