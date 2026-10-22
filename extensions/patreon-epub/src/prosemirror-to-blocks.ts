/**
 * Patreon's `content_json_string` (a JSON-stringified TipTap / ProseMirror doc)
 * → the same `Block[]` that `htmlToBlocks` produces. Patreon's API now sends
 * `content: null` for many posts and keeps the text only here.
 *
 * Pure and total: malformed JSON or an unexpected shape yields `null` / fewer
 * blocks, never a throw. Unknown node types keep their text.
 */
import { normalizeCharacters } from "@/lib/cleanup"
import { markSceneBreaks, type Block, type BlockAlign, type BlockRole, type InlineMark, type InlineRun } from "@/lib/reconstruct"

import { runsToBlock } from "./html-to-blocks"

type Node = { type?: unknown; text?: unknown; content?: unknown; marks?: unknown; attrs?: unknown }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
/** "hard_break" / "hardBreak" / "HardBreak" → "hardbreak". */
const kind = (v: unknown) => (typeof v === "string" ? v.replace(/[_-]/g, "").toLowerCase() : "")

const MARKS: Record<string, InlineMark> = {
  bold: "b", strong: "b", italic: "i", em: "i", underline: "u", strike: "s", strikethrough: "s",
}
const ALIGNS: Record<string, BlockAlign> = { center: "center", right: "right", justify: "justify" }

interface Ctx {
  role?: BlockRole
  li?: boolean
}

/** Parse and convert; null when the string isn't a usable doc or has no text. */
export function prosemirrorJsonToBlocks(json: string): Block[] | null {
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return null
  }
  if (!isObj(doc)) return null
  const blocks = prosemirrorToBlocks(doc)
  return blocks.some((b) => b.type !== "hr") ? blocks : null
}

export function prosemirrorToBlocks(doc: unknown): Block[] {
  const blocks: Block[] = []
  let runs: InlineRun[] = []
  let align: BlockAlign | undefined
  let ctx: Ctx = {}

  const flush = () => {
    const block = runsToBlock(runs)
    runs = []
    if (block) {
      if (ctx.li) block.type = "li"
      if (align) block.align = align
      if (ctx.role) block.role = ctx.role
      blocks.push(block)
    }
    align = undefined
  }

  const inline = (n: Node) => {
    if (typeof n.text !== "string") return
    const marks = Array.isArray(n.marks)
      ? [...new Set(n.marks.filter(isObj).map((m) => MARKS[kind(m.type)]).filter((m): m is InlineMark => !!m))]
      : []
    const text = normalizeCharacters(n.text)
    if (text) runs.push(marks.length ? { text, marks } : { text })
  }

  const children = (n: Node) => (Array.isArray(n.content) ? n.content.filter(isObj) : []) as Node[]

  const walk = (n: Node, depth: number) => {
    if (depth > 64) return
    const t = kind(n.type)
    const attrs = isObj(n.attrs) ? n.attrs : {}
    const within = (next: Ctx, fn: () => void) => {
      const saved = ctx
      ctx = { ...ctx, ...next }
      fn()
      ctx = saved
    }
    switch (t) {
      case "text":
        return inline(n)
      case "hardbreak":
        runs.push({ text: "", br: true })
        return
      case "horizontalrule":
        flush()
        blocks.push({ type: "hr", text: "* * *" })
        return
      case "paragraph":
      case "heading": {
        flush()
        const level = Math.min(4, Math.max(1, Number(attrs.level) || 1))
        const role: BlockRole | undefined = t === "heading" ? (`h${level}` as BlockRole) : undefined
        within(role ? { role } : {}, () => {
          for (const c of children(n)) walk(c, depth + 1)
          align = typeof attrs.textAlign === "string" ? ALIGNS[attrs.textAlign] : undefined
          flush()
        })
        return
      }
      case "blockquote":
        flush()
        within({ role: "blockquote" }, () => children(n).forEach((c) => walk(c, depth + 1)))
        flush()
        return
      case "listitem":
        flush()
        within({ li: true }, () => children(n).forEach((c) => walk(c, depth + 1)))
        flush()
        return
      default:
        // doc, bulletList, orderedList, and anything unknown: keep the text.
        // Pending text is flushed by the next block or at the end.
        inline(n)
        for (const c of children(n)) walk(c, depth + 1)
    }
  }
  if (isObj(doc)) walk(doc as Node, 0)
  flush()
  return markSceneBreaks(blocks)
}
