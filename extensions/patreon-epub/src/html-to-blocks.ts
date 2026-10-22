/**
 * Patreon post HTML → the app's `Block[]`, with inline formatting kept.
 *
 * A small tokenizer rather than DOMParser so it runs (and is unit-tested) in
 * Node as well as in the content script. Patreon post bodies are simple rich
 * text: `<p>` paragraphs with `<strong>`/`<em>`/`<u>`/`<s>`/`<br>`, the odd
 * heading, list, quotation or `<hr>`.
 *
 * Everything outside the allowlist is reduced to its text; no attribute
 * survives except a recognised `text-align` (mapped to `Block.align`). Output
 * is structured runs, never HTML, so `blocksToHtml` escapes every character.
 */
import { normalizeCharacters } from "@/lib/cleanup"
import {
  markSceneBreaks,
  type Block,
  type BlockAlign,
  type BlockRole,
  type InlineMark,
  type InlineRun,
} from "@/lib/reconstruct"

// ── Entities ─────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“",
  rdquo: "”", bdquo: "„", hellip: "…", bull: "•", middot: "·", prime: "′",
  Prime: "″", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", copy: "©",
  reg: "®", trade: "™", deg: "°", plusmn: "±", times: "×", divide: "÷",
  minus: "−", frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²",
  sup3: "³", para: "¶", sect: "§", cent: "¢", pound: "£", euro: "€", yen: "¥",
  iexcl: "¡", iquest: "¿", shy: "\u00AD", zwj: "\u200D", zwnj: "\u200C",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", hearts: "♥", spades: "♠",
  clubs: "♣", diams: "♦", larr: "←", rarr: "→", uarr: "↑", darr: "↓",
  harr: "↔", star: "☆", infin: "∞", le: "≤", ge: "≥", ne: "≠", asymp: "≈",
  dagger: "†", Dagger: "‡", loz: "◊", acute: "´", uml: "¨", micro: "µ",
  eacute: "é", Eacute: "É", egrave: "è", ecirc: "ê", aacute: "á", agrave: "à",
  acirc: "â", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü",
  szlig: "ß", ccedil: "ç", ntilde: "ñ", oacute: "ó", iacute: "í", uacute: "ú",
}

/** Decode HTML character references; unknown named ones are left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (full, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return full
      try {
        return String.fromCodePoint(code)
      } catch {
        return full
      }
    }
    return NAMED_ENTITIES[ref] ?? full
  })
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

/** Attribute-aware: a `>` inside a quoted attribute value doesn't end the tag. */
const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g

/** Elements whose content is never text the reader should see. */
const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "math", "iframe", "object",
  "embed", "button", "select", "textarea", "canvas", "video", "audio", "head", "title",
])
const VOID_TAGS = new Set([
  "br", "hr", "img", "input", "meta", "link", "source", "wbr", "area", "base", "col", "embed", "track",
])
/** Elements that start and end a block of text. */
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav",
  "figure", "figcaption", "pre", "address", "table", "thead", "tbody", "tr",
  "td", "th", "caption", "dl", "dt", "dd", "ul", "ol", "li", "blockquote",
  "h1", "h2", "h3", "h4", "h5", "h6", "center", "body", "html",
])
const MARK_FOR_TAG: Record<string, InlineMark> = {
  strong: "b", b: "b", em: "i", i: "i", cite: "i", u: "u", ins: "u",
  s: "s", strike: "s", del: "s",
}
const HEADING_ROLE: Record<string, BlockRole> = {
  h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h4", h6: "h4",
}

/** `text-align` from a `style` attribute, or a legacy `align` attribute. */
export function alignFromAttributes(attrs: string): BlockAlign | undefined {
  const style = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)
  const css = style ? decodeEntities(style[1] ?? style[2] ?? "") : ""
  const fromCss = /(?:^|;)\s*text-align\s*:\s*(center|right|justify)\b/i.exec(css)
  const legacy = /\balign\s*=\s*["']?(center|right|justify)\b/i.exec(attrs)
  const value = (fromCss?.[1] ?? legacy?.[1])?.toLowerCase()
  return value === "center" || value === "right" || value === "justify" ? value : undefined
}

interface OpenBlock {
  tag: string
  align?: BlockAlign
}

/** Whitespace that collapses: ASCII whitespace plus the hard spaces. */
const WS_RE = /[\s\u00A0\u202F\u2007]+/g

/**
 * Convert one post's HTML body to blocks. Empty paragraphs vanish, `* * *`
 * style dividers and `<hr>` become scene breaks, bold/italic/underline/strike
 * and line breaks become runs, and `text-align` becomes `Block.align`.
 */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = []
  const openBlocks: OpenBlock[] = []
  const markStack: InlineMark[] = []
  let runs: InlineRun[] = []
  let skipTag: string | null = null
  let skipDepth = 0

  const currentAlign = (): BlockAlign | undefined => {
    for (let k = openBlocks.length - 1; k >= 0; k--) if (openBlocks[k].align) return openBlocks[k].align
    return undefined
  }
  const currentRole = (): BlockRole | undefined => {
    for (let k = openBlocks.length - 1; k >= 0; k--) {
      const role = HEADING_ROLE[openBlocks[k].tag]
      if (role) return role
    }
    return openBlocks.some((b) => b.tag === "blockquote") ? "blockquote" : undefined
  }
  const inListItem = () => openBlocks.some((b) => b.tag === "li")

  const flush = () => {
    const block = runsToBlock(runs)
    runs = []
    if (!block) return
    if (inListItem()) block.type = "li"
    const align = currentAlign()
    const role = currentRole()
    if (align) block.align = align
    if (role) block.role = role
    blocks.push(block)
  }

  for (const m of html.matchAll(TOKEN_RE)) {
    const token = m[0]
    const closing = m[1] === "/"
    const tag = m[2]?.toLowerCase()
    const attrs = m[3] ?? ""

    if (skipTag) {
      if (tag === skipTag) {
        if (closing) skipDepth--
        else if (!attrs.trimEnd().endsWith("/")) skipDepth++
        if (skipDepth === 0) skipTag = null
      }
      continue
    }

    if (!tag) {
      if (token.startsWith("<!") || token.startsWith("<?")) continue
      // Text (or a stray "<" that starts no tag).
      const text = normalizeCharacters(decodeEntities(token))
      if (text) runs.push({ text, marks: markStack.length ? [...new Set(markStack)] : undefined })
      continue
    }

    if (!closing && SKIP_TAGS.has(tag)) {
      if (!VOID_TAGS.has(tag) && !attrs.trimEnd().endsWith("/")) {
        skipTag = tag
        skipDepth = 1
      }
      continue
    }

    if (tag === "br") {
      if (!closing) runs.push({ text: "", br: true })
      continue
    }
    if (tag === "hr") {
      if (closing) continue
      flush()
      blocks.push({ type: "hr", text: "* * *" })
      continue
    }

    const mark = MARK_FOR_TAG[tag]
    if (mark) {
      if (!closing) markStack.push(mark)
      else {
        const at = markStack.lastIndexOf(mark)
        if (at >= 0) markStack.splice(at, 1)
      }
      continue
    }

    if (BLOCK_TAGS.has(tag)) {
      flush()
      if (!closing) {
        openBlocks.push({ tag, align: alignFromAttributes(attrs) })
      } else {
        const at = openBlocks.map((b) => b.tag).lastIndexOf(tag)
        if (at >= 0) openBlocks.splice(at)
        // A block boundary also closes any formatting left open inside it.
        markStack.length = 0
      }
    }
    // Any other tag (span, a, img, font, sup…) contributes its text only.
  }
  flush()
  return markSceneBreaks(blocks)
}

/**
 * Normalize collected runs into one block, or null when nothing visible is
 * left. Whitespace collapses across run boundaries exactly as a browser would,
 * line breaks at either end are dropped, and adjacent runs with identical marks
 * merge. A block with no formatting at all gets no `runs` — it renders through
 * the same plain path as any other block.
 */
export function runsToBlock(input: InlineRun[]): Block | null {
  const out: InlineRun[] = []
  let atLineStart = true
  for (const r of input) {
    if (r.br) {
      // Trailing space before a line break is invisible.
      const last = out[out.length - 1]
      if (last && !last.br) last.text = last.text.replace(/ $/, "")
      out.push({ text: "", br: true })
      atLineStart = true
      continue
    }
    let text = r.text.replace(WS_RE, " ")
    if (atLineStart) text = text.replace(/^ /, "")
    if (!text) continue
    const prev = out[out.length - 1]
    if (prev && !prev.br && prev.text.endsWith(" ") && text.startsWith(" ")) text = text.slice(1)
    if (!text) continue
    const marks = r.marks?.length ? [...r.marks].sort() : undefined
    if (prev && !prev.br && sameMarks(prev.marks, marks)) prev.text += text
    else out.push(marks ? { text, marks } : { text })
    atLineStart = false
  }
  // Drop empty runs, and line breaks at either end.
  let runs = out.filter((r) => r.br || r.text)
  const last = runs[runs.length - 1]
  if (last && !last.br) last.text = last.text.replace(/ $/, "")
  runs = runs.filter((r) => r.br || r.text)
  while (runs.length && runs[0].br) runs.shift()
  while (runs.length && runs[runs.length - 1].br) runs.pop()
  // Collapse repeated line breaks to one.
  runs = runs.filter((r, k) => !(r.br && runs[k - 1]?.br))

  const text = runs.map((r) => (r.br ? " " : r.text)).join("").replace(/ {2,}/g, " ").trim()
  if (!text) return null
  const plain = runs.every((r) => !r.br && !r.marks)
  return plain ? { type: "p", text } : { type: "p", text, runs }
}

function sameMarks(a?: InlineMark[], b?: InlineMark[]): boolean {
  if (!a?.length && !b?.length) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((m, i) => m === b[i])
}
