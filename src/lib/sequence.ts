/**
 * Detects whether a set of file names form a clear numeric sequence
 * (e.g. "Chapter 1", "Chapter 2", …) and, if so, reports any gaps.
 */

const KEYWORD_RE =
  /\b(chapters?|chaps?|ch|parts?|pt|sections?|sects?|sec|pages?|pg|volumes?|vol|episodes?|eps?|books?|units?|lessons?|no|nos|num)\b\.?\s*[-_#]?\s*(\d{1,6})/i

// First standalone integer not part of a decimal / thousands group.
const FIRST_INT_RE = /(?<![\d,.])(\d{1,6})(?![\d,.]\d)/

const KEYWORD_LABELS: Record<string, string> = {
  chapter: "Chapter", chapters: "Chapter", chap: "Chapter", chaps: "Chapter", ch: "Chapter",
  part: "Part", parts: "Part", pt: "Part",
  section: "Section", sections: "Section", sect: "Section", sects: "Section", sec: "Section",
  page: "Page", pages: "Page", pg: "Page",
  volume: "Volume", volumes: "Volume", vol: "Volume",
  episode: "Episode", episodes: "Episode", ep: "Episode", eps: "Episode",
  book: "Book", books: "Book",
  unit: "Unit", units: "Unit",
  lesson: "Lesson", lessons: "Lesson",
  no: "No.", nos: "No.", num: "No.",
}

export interface Extracted {
  num: number | null
  /** Canonical label for the keyword that preceded the number, if any. */
  label: string | null
}

/** Pull the sequence number (and its keyword, if any) out of a file name. */
export function extractNumber(name: string): Extracted {
  const base = name.replace(/\.[^.]+$/, "") // strip extension

  const kw = base.match(KEYWORD_RE)
  if (kw) {
    return { num: parseInt(kw[2], 10), label: KEYWORD_LABELS[kw[1].toLowerCase()] ?? null }
  }

  const first = base.match(FIRST_INT_RE)
  if (first) return { num: parseInt(first[1], 10), label: null }

  return { num: null, label: null }
}

export interface SequenceInfo {
  /** True when the names look like a deliberate numeric sequence. */
  hasOrder: boolean
  /** Extracted number per input name, aligned to the input order. */
  numbers: (number | null)[]
  /** Missing numbers within [min, max], ascending. */
  missing: number[]
  /** Numbers used by more than one file, ascending. */
  duplicates: number[]
  /** Most common keyword label (e.g. "Chapter"), or null. */
  label: string | null
  min: number | null
  max: number | null
}

const EMPTY = (numbers: (number | null)[]): SequenceInfo => ({
  hasOrder: false,
  numbers,
  missing: [],
  duplicates: [],
  label: null,
  min: null,
  max: null,
})

export function analyzeSequence(names: string[]): SequenceInfo {
  const extracted = names.map(extractNumber)
  const numbers = extracted.map((e) => e.num)
  const present = numbers.filter((n): n is number => n !== null)

  if (present.length < 3) return EMPTY(numbers)

  const counts = new Map<number, number>()
  for (const n of present) counts.set(n, (counts.get(n) ?? 0) + 1)

  const unique = [...counts.keys()]
  const min = Math.min(...unique)
  const max = Math.max(...unique)
  const range = max - min + 1

  // Require a dense, contiguous-ish run where most files participate — this is
  // what separates "Chapter 1..53 with a couple gaps" from a random pile.
  const density = unique.length / range
  const coverage = present.length / numbers.length
  if (max <= min || range > 5000 || density < 0.6 || coverage < 0.6) {
    return EMPTY(numbers)
  }

  const missing: number[] = []
  for (let n = min; n <= max; n++) if (!counts.has(n)) missing.push(n)

  const duplicates = unique
    .filter((n) => (counts.get(n) ?? 0) > 1)
    .sort((a, b) => a - b)

  // Most common keyword label across the set.
  const labelCounts = new Map<string, number>()
  for (const e of extracted) {
    if (e.label) labelCounts.set(e.label, (labelCounts.get(e.label) ?? 0) + 1)
  }
  let label: string | null = null
  let best = 0
  for (const [k, c] of labelCounts) {
    if (c > best) {
      best = c
      label = k
    }
  }

  return { hasOrder: true, numbers, missing, duplicates, label, min, max }
}

/** Format a sorted list of numbers as compact ranges: [27,31,32] → "27, 31–32". */
export function formatNumberRanges(nums: number[]): string {
  if (nums.length === 0) return ""
  const sorted = [...nums].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) {
      prev = n
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = prev = n
  }
  parts.push(start === prev ? `${start}` : `${start}–${prev}`)
  return parts.join(", ")
}

/** The integers strictly between a and b: rangeBetween(26, 28) → [27]. */
export function rangeBetween(a: number, b: number): number[] {
  const out: number[] = []
  for (let n = a + 1; n < b; n++) out.push(n)
  return out
}
