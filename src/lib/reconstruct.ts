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

/** A block of output: a list item (`li`) or a normal paragraph (`p`). */
export interface Block {
  type: "p" | "li"
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
 * Reconstruct readable blocks from pdf.js glyph fragments. Groups fragments into
 * lines by baseline Y, inserts a space only at real horizontal gaps, then
 * assembles wrapped lines into paragraphs and bullet runs into list items.
 */
export function reconstructBlocks(items: Glyph[]): Block[] {
  const fragments = items.filter((it) => it.str.trim() !== "" || it.width > 0)
  if (fragments.length === 0) return []

  interface Line {
    y: number
    height: number
    items: Glyph[]
  }
  const lines: Line[] = []
  for (const it of fragments) {
    const y = it.transform[5]
    const h = it.height || 10
    const line = lines.find((l) => Math.abs(l.y - y) <= Math.max(l.height, h) * 0.5)
    if (line) {
      line.items.push(it)
      line.height = Math.max(line.height, h)
    } else {
      lines.push({ y, height: h, items: [it] })
    }
  }

  lines.sort((a, b) => b.y - a.y)

  const lineTexts: ReconstructedLine[] = lines
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

  return assembleBlocks(lineTexts)
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
 * user wants every percentage colored), never the keyword/box styling.
 *
 * Passing a custom styler is how the Style Editor re-renders an EPUB.
 */
export function blocksToHtml(blocks: Block[], styler: Styler = DEFAULT_STYLER): string {
  const prose = (text: string) => `<p>${styler.percents(escapeHtml(text))}</p>`
  const out: string[] = []
  let i = 0

  while (i < blocks.length) {
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
