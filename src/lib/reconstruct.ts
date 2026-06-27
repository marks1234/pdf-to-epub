/**
 * Geometry-based text reconstruction from pdf.js glyph fragments, plus the
 * HTML rendering that turns reconstructed blocks into chapter markup.
 *
 * Pure (no pdf.js / jepub imports) so it is unit-testable and reusable from a
 * Node harness. pdf-to-epub.ts feeds it pdf.js `TextItem`s (structurally a
 * `Glyph`) and wraps the result in the EPUB.
 */
import {
  colorizePercents,
  colorizeRarities,
  colorizeStatKeywords,
} from "@/lib/rarity"

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

/** A block that belongs in a stat sheet rather than the prose flow. */
function isStatLike(b: Block): boolean {
  if (b.type === "li") return true
  const t = b.text
  return bracketCount(t) >= 2 || /\d%/.test(t) || STAT_LABEL_RE.test(t)
}

/** Strong enough that a single such block is worth boxing on its own. */
function isStrongStat(b: Block): boolean {
  const t = b.text
  return bracketCount(t) >= 4 || (t.match(/\d%/g) || []).length >= 2 || STAT_LABEL_RE.test(t)
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

/** Full stat styling for one escaped line: rarities, keywords, then percents. */
function styleStat(text: string): string {
  return colorizePercents(colorizeStatKeywords(colorizeRarities(escapeHtml(text))))
}

/** Render the bullets of a stat run as a list, styled. */
function renderStatList(items: string[]): string {
  return `<ul class="stat-block">${items.map((t) => `<li>${styleStat(t)}</li>`).join("")}</ul>`
}

/**
 * Render blocks as chapter HTML.
 *
 * Runs of stat-like blocks become a `<div class="stat-sheet">` panel: bullets
 * render as a styled `<ul>`, and field lines (de-glued where needed) render as
 * `<div class="stat-line">`, all with rarity / keyword / percentage coloring.
 * Ordinary prose stays a plain `<p>` — only percentages are colored there (the
 * user wants every percentage colored), never the keyword/box styling.
 */
export function blocksToHtml(blocks: Block[]): string {
  const out: string[] = []
  let i = 0

  while (i < blocks.length) {
    if (!isStatLike(blocks[i])) {
      // Prose: plain paragraph, percentages still colored.
      out.push(`<p>${colorizePercents(escapeHtml(blocks[i].text))}</p>`)
      i++
      continue
    }

    // Gather a maximal run of stat-like blocks.
    const start = i
    while (i < blocks.length && isStatLike(blocks[i])) i++
    const run = blocks.slice(start, i)
    const substantial = run.length >= 2 || isStrongStat(run[0])

    if (!substantial) {
      // A lone weak stat block: keep it light. A bullet → a small styled list;
      // a weak paragraph → prose (percentages only) to stay safe.
      const b = run[0]
      if (b.type === "li") out.push(renderStatList([b.text]))
      else out.push(`<p>${colorizePercents(escapeHtml(b.text))}</p>`)
      continue
    }

    // A real stat sheet → a styled panel.
    const parts: string[] = []
    let j = 0
    while (j < run.length) {
      if (run[j].type === "li") {
        const items: string[] = []
        while (j < run.length && run[j].type === "li") items.push(run[j++].text)
        parts.push(renderStatList(items))
      } else {
        for (const line of splitGluedFields(run[j].text)) {
          if (line.trim()) parts.push(`<div class="stat-line">${styleStat(line)}</div>`)
        }
        j++
      }
    }
    out.push(`<div class="stat-sheet">${parts.join("")}</div>`)
  }

  return out.join("\n")
}
