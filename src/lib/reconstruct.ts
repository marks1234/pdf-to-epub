/**
 * Geometry-based text reconstruction from pdf.js glyph fragments, plus the
 * HTML rendering that turns reconstructed blocks into chapter markup.
 *
 * Pure (no pdf.js / jepub imports) so it is unit-testable and reusable from a
 * Node harness. pdf-to-epub.ts feeds it pdf.js `TextItem`s (structurally a
 * `Glyph`) and wraps the result in the EPUB.
 */
import {
  createStyler,
  DEFAULT_STYLE_CONFIG,
  type Styler,
} from "@/lib/styles"
import { isSceneBreak, stripRunningHeadersFooters } from "@/lib/cleanup"

/** The built-in styler; rendering uses this unless a custom one is passed. */
export const DEFAULT_STYLER: Styler = createStyler(DEFAULT_STYLE_CONFIG)

// Characters illegal in XML 1.0: control chars below 0x20 except tab/newline/CR,
// plus the U+FFFE/U+FFFF non-characters. PDF text extraction occasionally emits
// these, which would otherwise make the chapter XHTML not well-formed.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g

export function sanitize(text: string): string {
  return text.replace(INVALID_XML_CHARS, "")
}

export function escapeHtml(text: string): string {
  return sanitize(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** Minimal shape of a pdf.js TextItem that the reconstruction needs. */
export interface Glyph {
  str: string
  width: number
  height: number
  transform: number[]
}

/** One assembled line of text plus the geometry used to merge or split it. */
export interface ReconstructedLine {
  y: number
  height: number
  text: string
}

/**
 * A block of output: a list item (`li`), a normal paragraph (`p`), or a scene
 * break (`hr`) — a `* * *` / `◇◇◇` divider recognized as semantic markup rather
 * than left as a paragraph of punctuation. An `hr` block keeps the original
 * divider text so stored chapters round-trip losslessly; nothing renders it.
 */
export interface Block {
  type: "p" | "li" | "hr"
  text: string
}

// Bullet glyphs that mark a list item. A line beginning with one of these is a
// hard line boundary (stat blocks / property lists are single-spaced, so a
// vertical-gap test alone can't tell them apart from a wrapped prose line).
const BULLET_RE = /^[•‣◦▪●∙]\s+/

/**
 * Assemble reconstructed lines into output blocks. See the original commit for
 * the full rationale: bullet glyphs and post-bullet labels are hard line
 * boundaries; everything else merges as wrapped prose unless a large vertical
 * gap intervenes. Pure and geometry-free so it can be unit-tested.
 */
export function assembleBlocks(lines: ReconstructedLine[]): Block[] {
  const blocks: Block[] = []
  let prevY: number | null = null
  let prevHeight = 10
  let prevWasBullet = false

  for (const line of lines) {
    const isBullet = BULLET_RE.test(line.text)
    let startNewBlock: boolean

    if (prevY === null) {
      startNewBlock = true
    } else if (isBullet) {
      startNewBlock = true
    } else if (prevWasBullet) {
      const bigGap = prevY - line.y > prevHeight * 1.8
      const looksLikeWrap = /^[a-z]/.test(line.text)
      startNewBlock = bigGap || !looksLikeWrap
    } else {
      startNewBlock = prevY - line.y > prevHeight * 1.8
    }

    if (startNewBlock) {
      blocks.push({ type: isBullet ? "li" : "p", text: line.text })
    } else {
      const last = blocks[blocks.length - 1]
      last.text = `${last.text} ${line.text}`
    }

    prevY = line.y
    prevHeight = line.height
    prevWasBullet = isBullet
  }

  return blocks.map((b) =>
    b.type === "li" ? { ...b, text: b.text.replace(BULLET_RE, "").trim() } : b,
  )
}

/**
 * Group pdf.js glyph fragments into lines by baseline Y and read each line out
 * left-to-right, inserting a space only at real horizontal gaps.
 *
 * Grouping is linear: fragments are bucketed by `round(y / maxHeight)` in a Map
 * instead of scanning every known line per fragment (which was O(n²) and the
 * dominant cost on text-dense pages). Because the merge tolerance is at most
 * `maxHeight / 2`, two fragments that belong together can differ by at most one
 * bucket, so checking the bucket and its two neighbours is exhaustive. The
 * ±tolerance test itself is unchanged, and ties still resolve to the
 * earliest-created line, so output is identical to the old scan.
 */
export function reconstructLines(items: Glyph[]): ReconstructedLine[] {
  const fragments = items.filter((it) => it.str.trim() !== "" || it.width > 0)
  if (fragments.length === 0) return []

  interface Line {
    seq: number
    y: number
    height: number
    items: Glyph[]
  }

  let maxHeight = 1
  for (const it of fragments) maxHeight = Math.max(maxHeight, it.height || 10)

  const lines: Line[] = []
  const buckets = new Map<number, Line[]>()
  for (const it of fragments) {
    const y = it.transform[5]
    const h = it.height || 10
    const key = Math.round(y / maxHeight)

    let best: Line | null = null
    for (let k = key - 1; k <= key + 1; k++) {
      const bucket = buckets.get(k)
      if (!bucket) continue
      for (const l of bucket) {
        if (best !== null && l.seq > best.seq) continue
        if (Math.abs(l.y - y) <= Math.max(l.height, h) * 0.5) best = l
      }
    }

    if (best) {
      best.items.push(it)
      best.height = Math.max(best.height, h)
    } else {
      const line: Line = { seq: lines.length, y, height: h, items: [it] }
      lines.push(line)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(line)
      else buckets.set(key, [line])
    }
  }

  lines.sort((a, b) => b.y - a.y)

  return lines
    .map((line) => {
      const sorted = [...line.items].sort(
        (a, b) => a.transform[4] - b.transform[4],
      )
      let text = ""
      let prevEndX: number | null = null
      for (const it of sorted) {
        const x = it.transform[4]
        const w = it.width || 0
        const h = it.height || line.height
        if (prevEndX !== null) {
          const gap = x - prevEndX
          if (gap > h * 0.25 && !text.endsWith(" ")) text += " "
        }
        text += it.str
        prevEndX = x + w
      }
      return { y: line.y, height: line.height, text: text.replace(/\s+/g, " ").trim() }
    })
    .filter((l) => l.text)
}

/**
 * Reconstruct readable blocks from one page's glyph fragments: lines by
 * baseline Y, then wrapped lines assembled into paragraphs and bullet runs into
 * list items. For a whole file use {@link reconstructChapterBlocks}, which also
 * strips running headers and stitches paragraphs across page boundaries.
 */
export function reconstructBlocks(items: Glyph[]): Block[] {
  return assembleBlocks(reconstructLines(items))
}

// ── Page stitching ───────────────────────────────────────────────────────────

/**
 * Ends a sentence — so the next block is a new paragraph even if it starts
 * lowercase. Closing quotes and brackets count: dialogue often ends `…," she`.
 */
const SENTENCE_END_RE = /[.!?…"”’'\]]\s*$/
/** A continuation of the previous page's paragraph starts mid-sentence. */
const CONTINUATION_RE = /^\p{Ll}/u

/** Tag divider blocks (`* * *`, `◇◇◇`) as semantic scene breaks. */
export function markSceneBreaks(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.type === "p" && isSceneBreak(b.text) ? { type: "hr" as const, text: b.text } : b,
  )
}

/**
 * Concatenate per-page blocks into one chapter, healing paragraphs that a page
 * break cut in half: the last block of a page and the first of the next are
 * joined when the first does not end a sentence and the second starts with a
 * lowercase letter — the same wrap heuristic {@link assembleBlocks} uses inside
 * a page. Only prose (`p`) blocks are ever joined; list items and scene breaks
 * stay separate.
 *
 * Running headers/footers must already be gone (see `stripRunningHeadersFooters`),
 * or a page number would sit between the two halves and block the join.
 */
export function mergePageBlocks(pages: Block[][]): Block[] {
  const out: Block[] = []
  for (const page of pages) {
    if (page.length === 0) continue
    const prev = out[out.length - 1]
    const first = page[0]
    const continues =
      prev !== undefined &&
      prev.type === "p" &&
      first.type === "p" &&
      !SENTENCE_END_RE.test(prev.text) &&
      CONTINUATION_RE.test(first.text)
    if (continues) {
      out[out.length - 1] = { ...prev, text: `${prev.text} ${first.text}` }
      for (let i = 1; i < page.length; i++) out.push(page[i])
    } else {
      for (const block of page) out.push(block)
    }
  }
  return out
}

/**
 * Full per-file reconstruction: every page's glyphs in, one chapter's blocks
 * out. Pure (no pdf.js), so the whole cross-page pipeline is unit-testable.
 *
 * Order matters. Headers/footers are removed while line data is still per-page
 * (that is the only place their position is knowable) and before the pages are
 * stitched, so a running footer can't wedge itself between the two halves of a
 * split paragraph. Scene breaks are tagged before stitching too, so a divider
 * at a page edge is never swallowed by the paragraph after it.
 */
export function reconstructChapterBlocks(pages: Glyph[][]): Block[] {
  const pageLines = stripRunningHeadersFooters(pages.map(reconstructLines))
  const pageBlocks = pageLines.map((lines) => markSceneBreaks(assembleBlocks(lines)))
  return mergePageBlocks(pageBlocks)
}

// ── Stat-sheet detection & rendering ─────────────────────────────────────────

// Opening lines of the recurring "Appraisal" / status readouts. These are not
// bulleted, so without this they'd look like ordinary prose paragraphs.
const STAT_LABEL_RE =
  /^(Primary (Title|Crafters?|Attribute)|Crafted Grade|Crafting Station|Classification|Subsume Results?|Material Results?|Captured |Enhanced Attribute|Advanced Attribute|Reactor|Power Source|Paired Devices|Evolution|Est\. (Value|Subsumed|Atmospheric)|Estimated|Build (Quality|Condition)|Internal Essence|Assimilation|Statistics|.+: (Priority List|Statistics|Status Report))\b/

/** Count `[` characters — a quick proxy for "field-dense, table-like" text. */
function bracketCount(t: string): number {
  return (t.match(/\[/g) || []).length
}

// ── Labeled-field splitting ──────────────────────────────────────────────────
// Stat sheets pack several "Label: value" fields — and "Name: description"
// ability entries — into one reflowed paragraph. We break them into one line per
// field. Tricky bits handled:
//   • a colon INSIDE a bracket ("[Maestro: 1]") is not a field boundary (we track
//     bracket depth and only split on depth-0 colons);
//   • runs of adjacent bracket tags ("[A-Rank][B-Rank]…") stay on their field's
//     line (no colon between them);
//   • a value word right after a label ("No" in "Evolution: No Assimilation:") is
//     not absorbed into the next label (we stop the label at a `: `-preceded word).

const LABEL_WORD = /[A-Za-z'.-]/

/** Start index of the field label whose depth-0 colon is at `colonIdx`, else null. */
function fieldLabelStart(text: string, colonIdx: number): number | null {
  let labelStart: number | null = null
  let words = 0
  let i = colonIdx - 1
  while (i >= 0 && words < 3) {
    let j = i
    while (j >= 0 && LABEL_WORD.test(text[j])) j--
    const word = text.slice(j + 1, i + 1)
    if (!/^[A-Z]/.test(word)) break
    // A longer word ending in "." is a sentence end (e.g. "Phylacteries."), not a
    // label abbreviation (e.g. "Est.") — stop without absorbing it.
    if (word.endsWith(".") && word.length > 4) break
    // A word immediately preceded by ": " is the previous field's value, not part
    // of this label — stop without absorbing it.
    if (text[j] === " " && text[j - 1] === ":") break
    labelStart = j + 1
    words++
    if (text[j] !== " ") break // label words are single-space separated
    i = j - 1
  }
  return labelStart
}

/** Split a reflowed stat paragraph into one string per "Label: value" field. */
function splitLabeledFields(text: string): string[] {
  const breaks = new Set<number>()
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "[") depth++
    else if (ch === "]") depth = Math.max(0, depth - 1)
    else if (ch === ":" && depth === 0) {
      const after = text[i + 1]
      // A field colon is followed by a space, an opening bracket, or end-of-text.
      if (after !== undefined && after !== " " && after !== "\t" && after !== "[") continue
      const start = fieldLabelStart(text, i)
      if (start !== null && start > 0) breaks.add(start)
    }
  }
  const cuts = [0, ...[...breaks].sort((a, b) => a - b), text.length]
  const parts: string[] = []
  for (let k = 0; k < cuts.length - 1; k++) {
    const seg = text.slice(cuts[k], cuts[k + 1]).replace(/^[|\s]+|[|\s]+$/g, "")
    if (seg) parts.push(seg)
  }
  return parts.length ? parts : [text.trim()].filter(Boolean)
}

/**
 * A reflowed paragraph that is really several "Label: value" fields. Gated on
 * >=3 depth-0 field labels so ordinary prose (which rarely has three
 * "Capitalized:" labels) and single "Label: [value]" stat lines are left alone.
 */
function isLabeledFieldBlock(text: string): boolean {
  return splitLabeledFields(text).length >= 3
}

/** A block that belongs in a stat sheet rather than the prose flow. */
function isStatLike(b: Block): boolean {
  if (b.type === "hr") return false
  if (b.type === "li") return true
  const t = b.text
  return bracketCount(t) >= 2 || /\d%/.test(t) || STAT_LABEL_RE.test(t) || isLabeledFieldBlock(t)
}

/** Strong enough that a single such block is worth boxing on its own. */
function isStrongStat(b: Block): boolean {
  const t = b.text
  return (
    bracketCount(t) >= 4 ||
    (t.match(/\d%/g) || []).length >= 2 ||
    STAT_LABEL_RE.test(t) ||
    isLabeledFieldBlock(t)
  )
}

// Split a run-on stat paragraph where two fields were glued with no space —
// e.g. "…[Missing: 1]Internal Damage…" or "…0%Essence Reserve…". A digit, `]`,
// `%` or `)` immediately followed by a capitalized word starts a new field.
const GLUED_FIELD_RE = /([\]%)0-9])(?=[A-Z][a-z])/g

function splitGluedFields(text: string): string[] {
  // Block text never contains newlines (reconstruction joins lines with spaces),
  // so a newline is a safe split sentinel.
  return text.replace(GLUED_FIELD_RE, "$1\n").split("\n")
}

/** Render the bullets of a stat run as a list, styled by the given styler. */
function renderStatList(items: string[], styler: Styler): string {
  return `<ul class="stat-block">${items.map((t) => `<li>${styler.styleStat(t)}</li>`).join("")}</ul>`
}

/**
 * Render blocks as chapter HTML using `styler` (defaults to the built-in look).
 *
 * Runs of stat-like blocks become a `<div class="stat-sheet">` panel: bullets
 * render as a styled `<ul>`, and field lines (de-glued where needed) render as
 * `<div class="stat-line">`, all with rarity / keyword / percentage coloring.
 * Ordinary prose stays a plain `<p>` — only percentages are colored there (the
 * user wants every percentage colored), never the keyword/box styling. A scene
 * break renders as `<hr class="scene-break" />`.
 *
 * Passing a custom styler is how the Style Editor re-renders an EPUB.
 */
export function blocksToHtml(blocks: Block[], styler: Styler = DEFAULT_STYLER): string {
  const prose = (text: string) => `<p>${styler.percents(escapeHtml(text))}</p>`
  const out: string[] = []
  let i = 0

  while (i < blocks.length) {
    if (blocks[i].type === "hr") {
      // Self-closing and class-only: the stylesheet lives in styles.ts, and an
      // unstyled <hr> already reads as a divider on Kindle.
      out.push('<hr class="scene-break" />')
      i++
      continue
    }
    if (!isStatLike(blocks[i])) {
      out.push(prose(blocks[i].text))
      i++
      continue
    }

    // Gather a maximal run of stat-like blocks.
    const start = i
    while (i < blocks.length && isStatLike(blocks[i])) i++
    const run = blocks.slice(start, i)
    const substantial = run.length >= 2 || isStrongStat(run[0])

    if (!substantial) {
      // A lone weak stat block: a bullet → a small styled list; a weak
      // paragraph → prose (percentages only) to stay safe.
      const b = run[0]
      out.push(b.type === "li" ? renderStatList([b.text], styler) : prose(b.text))
      continue
    }

    // A real stat sheet → a styled panel.
    const parts: string[] = []
    let j = 0
    while (j < run.length) {
      if (run[j].type === "li") {
        const items: string[] = []
        while (j < run.length && run[j].type === "li") items.push(run[j++].text)
        parts.push(renderStatList(items, styler))
      } else {
        // Multi-field paragraphs split per "Label: value" entry; other field
        // lines split where extraction glued two fields together.
        const lines = isLabeledFieldBlock(run[j].text)
          ? splitLabeledFields(run[j].text)
          : splitGluedFields(run[j].text)
        for (const line of lines) {
          if (line.trim()) parts.push(`<div class="stat-line">${styler.styleStat(line)}</div>`)
        }
        j++
      }
    }
    out.push(`<div class="stat-sheet">${parts.join("")}</div>`)
  }

  return out.join("\n")
}
