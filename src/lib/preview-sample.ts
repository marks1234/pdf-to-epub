/**
 * Picking a representative excerpt of a converted book to preview styles with.
 *
 * The style editor's canned sample only exercises the stat-sheet rules; when a
 * real book is at hand it is far more useful to show *that* book's own text.
 * The interesting part of a LitRPG-style book is its stat sheets, so the picker
 * hunts for the longest run of stat-like blocks and pads it with surrounding
 * prose for context. Books with no stat content at all fall back to the opening
 * of their longest chapter.
 *
 * Pure and free of React/DOM so it is unit-testable.
 */
import type { Block } from "@/lib/reconstruct"

/** A chapter as stored on an output record. Structural to avoid a cycle. */
export interface SampleChapter {
  title: string
  blocks: Block[]
}

/**
 * Cheap "this line looks like a stat sheet" test: a bracketed number, a percent
 * sign, or a closing bracket. Deliberately looser than reconstruct.ts's own
 * classifier — this only has to *find* an interesting neighbourhood, not decide
 * how to render it.
 */
export const STAT_HINT_RE = /\[\d|%|\]/

/** Blocks shown around a stat run (the run itself may make it longer). */
export const SAMPLE_CONTEXT = 10

/** Blocks taken from the longest chapter when no stat run exists. */
export const SAMPLE_FALLBACK = 15

function isStatHint(block: Block): boolean {
  return block.type !== "hr" && STAT_HINT_RE.test(block.text)
}

/** Longest run of consecutive stat-like blocks, or null if there is none. */
function longestStatRun(blocks: Block[]): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null
  let i = 0
  while (i < blocks.length) {
    if (!isStatHint(blocks[i])) {
      i++
      continue
    }
    const start = i
    while (i < blocks.length && isStatHint(blocks[i])) i++
    // Strictly greater keeps the earliest run when two are the same length.
    if (!best || i - start > best.end - best.start) best = { start, end: i }
  }
  return best
}

/**
 * Choose a slice of one chapter to preview.
 *
 * Prefers the longest run of stat-like blocks found anywhere in the book,
 * centred in a window of at least {@link SAMPLE_CONTEXT} blocks so the panel is
 * seen next to ordinary prose. With no stat content anywhere, returns the first
 * {@link SAMPLE_FALLBACK} blocks of the chapter with the most blocks. Returns an
 * empty array when there is nothing to show, which callers treat as "use the
 * canned sample".
 */
export function pickSampleBlocks(
  chapters: readonly SampleChapter[] | undefined,
  context = SAMPLE_CONTEXT,
  fallback = SAMPLE_FALLBACK,
): Block[] {
  if (!chapters || chapters.length === 0) return []

  let bestBlocks: Block[] | null = null
  let bestRun: { start: number; end: number } | null = null

  for (const chapter of chapters) {
    const run = longestStatRun(chapter.blocks)
    if (!run) continue
    if (!bestRun || run.end - run.start > bestRun.end - bestRun.start) {
      bestRun = run
      bestBlocks = chapter.blocks
    }
  }

  if (bestRun && bestBlocks) {
    const runLength = bestRun.end - bestRun.start
    const target = Math.min(bestBlocks.length, Math.max(context, runLength))
    // Centre the window on the run, then clamp it inside the chapter.
    const before = Math.floor((target - runLength) / 2)
    const end = Math.min(bestBlocks.length, Math.max(bestRun.start - before, 0) + target)
    return bestBlocks.slice(Math.max(0, end - target), end)
  }

  let longest = chapters[0]
  for (const chapter of chapters)
    if (chapter.blocks.length > longest.blocks.length) longest = chapter
  return longest.blocks.slice(0, fallback)
}
