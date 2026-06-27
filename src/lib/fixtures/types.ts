import type { Block, ReconstructedLine } from "@/lib/reconstruct"

/**
 * A regression case. Provide EITHER `lines` (raw reconstructed lines, run through
 * the full assemble→render pipeline) OR `blocks` (skip straight to rendering),
 * then assert on the produced chapter `html` (and the stylesheet `css`).
 *
 * To add a case: drop a `*.fixture.ts` file in this folder that
 * `export default`s one of these. `regression.test.ts` auto-discovers it.
 */
export interface Fixture {
  name: string
  lines?: ReconstructedLine[]
  blocks?: Block[]
  check(html: string, css: string): void
}

/**
 * Build single-spaced reconstructed lines (top→bottom: PDF Y decreases). One
 * unit of leading keeps the gap under the new-paragraph threshold, mimicking the
 * tightly-packed lines that real reflow collapses.
 */
export function statLines(texts: string[], height = 10): ReconstructedLine[] {
  return texts.map((text, i) => ({ y: 1000 - i * height, height, text }))
}

/** Count non-overlapping occurrences of a literal substring. */
export function countOf(haystack: string, needle: string): number {
  let n = 0
  let i = 0
  for (;;) {
    const at = haystack.indexOf(needle, i)
    if (at === -1) return n
    n++
    i = at + needle.length
  }
}
