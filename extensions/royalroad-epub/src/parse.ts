/**
 * Royal Road page HTML → fiction metadata, the chapter list, and chapter bodies.
 *
 * String-based (no DOMParser) so it runs in Node tests as well as in the
 * content script. Only pages the reader's own browser fetched are parsed.
 */
import { decodeEntities } from "../../patreon-epub/src/html-to-blocks"

export interface FictionMeta {
  id: string
  title: string
  author: string
  description?: string
  coverUrl?: string
}

export interface ChapterRef {
  id: string
  title: string
  /** Absolute path on www.royalroad.com, e.g. /fiction/1/x/chapter/2/y */
  url: string
}

export interface ChapterBody {
  /** Main chapter HTML with anti-copy hidden paragraphs removed. */
  html: string
  /** Author's notes shown above the chapter. */
  notesBefore: string[]
  /** Author's notes shown below the chapter. */
  notesAfter: string[]
}

const FICTION_PATH = /^\/fiction\/(\d+)(?:\/|$)/

/** Fiction id from a /fiction/<id>/... path, or null. Chapter pages count too. */
export function fictionIdFromPath(path: string): string | null {
  return FICTION_PATH.exec(path)?.[1] ?? null
}

/** Is this the fiction's overview page (not a chapter, review or other subpage)? */
export function isFictionOverview(path: string): boolean {
  return /^\/fiction\/\d+(?:\/[^/]+)?\/?$/.test(path)
}

function metaContent(html: string, key: string): string | undefined {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const a = new RegExp(`<meta\\s[^>]*(?:property|name)=["']${esc}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)
  const b = new RegExp(`<meta\\s[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`, "i").exec(html)
  const v = (a ?? b)?.[1]
  return v ? decodeEntities(v).trim() || undefined : undefined
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * The inner HTML of the first element whose opening tag matches `open`,
 * balancing nested tags of the same name.
 */
export function innerOf(html: string, open: RegExp, from = 0): { inner: string; end: number } | null {
  const re = new RegExp(open.source, open.flags.includes("g") ? open.flags : open.flags + "g")
  re.lastIndex = from
  const m = re.exec(html)
  if (!m) return null
  const tag = /^<([a-z0-9]+)/i.exec(m[0])?.[1]?.toLowerCase()
  if (!tag) return null
  const start = m.index + m[0].length
  const tok = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi")
  tok.lastIndex = start
  let depth = 1
  let t: RegExpExecArray | null
  while ((t = tok.exec(html))) {
    if (t[2] === "/") continue
    depth += t[1] ? -1 : 1
    if (depth === 0) return { inner: html.slice(start, t.index), end: tok.lastIndex }
  }
  return { inner: html.slice(start), end: html.length }
}

function classOpen(cls: string, tag = "div"): RegExp {
  return new RegExp(`<${tag}\\b[^>]*\\bclass=["'](?:[^"']*\\s)?${cls}(?:\\s[^"']*)?["'][^>]*>`, "i")
}

export function parseFictionMeta(html: string, id: string): FictionMeta {
  const h1 = innerOf(html, /<h1\b[^>]*>/i)
  const title = metaContent(html, "og:title") ?? (h1 ? stripTags(h1.inner) : undefined) ?? `Royal Road fiction ${id}`
  const author =
    metaContent(html, "books:author") ??
    (() => {
      const m = /<a\b[^>]*href=["']\/profile\/\d+["'][^>]*>([\s\S]*?)<\/a>/i.exec(html)
      return m ? stripTags(m[1]) : undefined
    })() ??
    "Unknown author"
  const descBlock = innerOf(html, classOpen("description"))
  const description = (descBlock ? stripTags(descBlock.inner) : undefined) || metaContent(html, "og:description")
  let coverUrl = metaContent(html, "og:image")
  if (!coverUrl) {
    const m = /<img\b[^>]*class=["'][^"']*\bthumbnail\b[^"']*["'][^>]*src=["']([^"']+)["']/i.exec(html)
    coverUrl = m?.[1]
  }
  if (coverUrl && /nocover/i.test(coverUrl)) coverUrl = undefined
  return { id, title, author, description, coverUrl }
}

/** Find the `window.chapters = [...]` array literal, bracket-balanced. */
function chaptersJson(html: string): string | null {
  const at = /window\.chapters\s*=\s*\[/.exec(html)
  if (!at) return null
  const start = at.index + at[0].length - 1
  let depth = 0
  let inStr = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (c === "\\") i++
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === "[") depth++
    else if (c === "]" && --depth === 0) return html.slice(start, i + 1)
  }
  return null
}

/**
 * The fiction's chapter list, in reading order. Prefers the page's
 * `window.chapters` data (it lists every chapter, while the table may be
 * paginated), falling back to the chapter table rows.
 */
export function parseChapterList(html: string): ChapterRef[] {
  const json = chaptersJson(html)
  if (json) {
    try {
      const raw = JSON.parse(json) as { id?: number | string; title?: string; url?: string; order?: number; visible?: number | boolean; isUnlocked?: boolean }[]
      const list = raw
        .filter((c) => c && c.url && c.visible !== 0 && c.visible !== false)
        .map((c, i) => ({ c, i }))
        .sort((a, b) => (a.c.order ?? a.i) - (b.c.order ?? b.i) || a.i - b.i)
        .map(({ c }) => ({
          id: String(c.id ?? /\/chapter\/(\d+)/.exec(c.url!)?.[1] ?? c.url),
          title: decodeEntities(String(c.title ?? "")).trim() || "Untitled chapter",
          url: c.url!,
        }))
      if (list.length) return list
    } catch {
      // fall through to the table
    }
  }
  const out: ChapterRef[] = []
  const seen = new Set<string>()
  const row = /<tr\b[^>]*\bclass=["'][^"']*\bchapter-row\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi
  let m: RegExpExecArray | null
  while ((m = row.exec(html))) {
    const a = /<a\b[^>]*href=["'](\/fiction\/\d+\/[^"']*\/chapter\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i.exec(m[1])
    if (!a || seen.has(a[2])) continue
    seen.add(a[2])
    out.push({ id: a[2], url: decodeEntities(a[1]), title: stripTags(a[3]) || "Untitled chapter" })
  }
  return out
}

/**
 * Classes the page hides with CSS (`display: none`). Royal Road inserts a
 * hidden "this story was stolen" line into each chapter with a random class.
 */
export function hiddenClasses(html: string): string[] {
  const out = new Set<string>()
  const style = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let s: RegExpExecArray | null
  while ((s = style.exec(html))) {
    const rule = /([^{}]+)\{([^}]*)\}/g
    let r: RegExpExecArray | null
    while ((r = rule.exec(s[1]))) {
      if (!/display\s*:\s*none/i.test(r[2])) continue
      for (const sel of r[1].split(",")) {
        const m = /^\s*(?:[a-z]+)?\.([\w-]+)\s*$/i.exec(sel)
        if (m) out.add(m[1])
      }
    }
  }
  return [...out]
}

/** Remove every element carrying one of `classes` (with its content). */
export function removeClassed(html: string, classes: string[]): string {
  let out = html
  for (const cls of classes) {
    const esc = cls.replace(/[-]/g, "\\-")
    const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bclass=["'][^"']*(?<![\\w-])${esc}(?![\\w-])[^"']*["'][^>]*>`, "i")
    for (let guard = 0; guard < 50; guard++) {
      const m = open.exec(out)
      if (!m) break
      const got = innerOf(out, open, m.index)
      out = out.slice(0, m.index) + out.slice(got ? got.end : m.index + m[0].length)
    }
  }
  return out
}

export function parseChapter(html: string): ChapterBody {
  const hidden = hiddenClasses(html)
  const clean = (s: string) => removeClassed(s, hidden).trim()
  const content = innerOf(html, classOpen("chapter-content"))
  if (!content) throw new Error("Couldn't find the chapter text on the page.")
  const notesBefore: string[] = []
  const notesAfter: string[] = []
  const noteOpen = classOpen("author-note")
  const contentAt = html.search(classOpen("chapter-content"))
  let from = 0
  for (;;) {
    const at = html.slice(from).search(noteOpen)
    if (at < 0) break
    const got = innerOf(html, noteOpen, from + at)
    if (!got) break
    const text = clean(got.inner)
    if (stripTags(text)) (from + at < contentAt ? notesBefore : notesAfter).push(text)
    from = got.end
  }
  return { html: clean(content.inner), notesBefore, notesAfter }
}
