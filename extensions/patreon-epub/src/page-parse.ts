/**
 * String-level parsing of Patreon *pages* (as opposed to API JSON): the
 * collection page's title and post links, and the body of a rendered post page.
 *
 * Pure string work (no DOM) so it is unit-tested in Node and can be smoke-run
 * against a saved page. Patreon's CSS-module class names are hashed
 * (`RichText-module__5kju5G__root`), so everything here matches on stable
 * prefixes and `data-tag` attributes, never on a full class name.
 */
import { decodeEntities } from "./html-to-blocks"

/** `/collection/552396`, `/collection/my-book-552396`, `/cw/x/collection/552396/` → "552396". */
export function collectionIdFromPath(pathname: string): string | null {
  return /\/collection\/(?:[^/]*?-)?(\d+)(?:[/-]|$)/.exec(pathname)?.[1] ?? null
}

/**
 * The post id of any Patreon post link (query ignored, origin required):
 * `/posts/123`, `/posts/chapter-476-123?utm=…`. Not collection-filtered.
 */
export function postIdOf(href: string, base = "https://www.patreon.com"): string | null {
  let u: URL
  try {
    u = new URL(href, base)
  } catch {
    return null
  }
  if (!/^(www\.)?patreon\.com$/i.test(u.hostname)) return null
  return /\/posts\/(?:[^/]*-)?(\d+)\/?$/.exec(u.pathname)?.[1] ?? null
}

/** Cover images are only fetched from Patreon itself or its CDN. */
export function acceptCoverUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === "https:" && (u.hostname === "www.patreon.com" || u.hostname.endsWith(".patreonusercontent.com"))
  } catch {
    return false
  }
}

export interface CollectionTitleInfo {
  title?: string
  creator?: string
  postCount?: number
}

/**
 * Parse the document title Patreon gives a collection page:
 * "Nightmare Realm Summoner | Collection from Actus | 178 posts | Patreon".
 */
export function parseCollectionDocTitle(docTitle: string): CollectionTitleInfo {
  const parts = docTitle.split("|").map((p) => p.trim())
  const info: CollectionTitleInfo = {}
  const fromIdx = parts.findIndex((p) => /^collection from\s+/i.test(p))
  if (fromIdx > 0) info.title = parts.slice(0, fromIdx).join(" | ")
  if (fromIdx >= 0) info.creator = parts[fromIdx].replace(/^collection from\s+/i, "").trim() || undefined
  // "178 posts", "178 Beiträge", "1.234 publicaciones": any "<number> <word>"
  // part after the creator (so a title like "300 Spartans" can't match).
  const countParts = fromIdx >= 0 ? parts.slice(fromIdx + 1) : parts.slice(1)
  const count = countParts.map((p) => /^(\d[\d.,\s]*)\s+\p{L}+$/u.exec(p)).find(Boolean)
  if (count) info.postCount = parseInt(count[1].replace(/\D/g, ""), 10)
  return info
}

/**
 * Post IDs linked from a collection page, in page order, de-duplicated. Only
 * links tagged with this collection count (`/posts/123?collection=552396`), so
 * "more from this creator" links elsewhere on the page don't leak in.
 */
export function postIdsFromCollectionHtml(html: string, collectionId: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const re = /href\s*=\s*["']([^"']*\/posts\/[^"']*)["']/gi
  for (const m of html.matchAll(re)) {
    const id = postIdFromHref(decodeEntities(m[1]), collectionId)
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

/**
 * The post ID in a post link, if it belongs to `collectionId`. Handles both
 * `/posts/123` and slugged `/posts/chapter-476-123` forms.
 */
export function postIdFromHref(href: string, collectionId: string): string | null {
  const m = /\/posts\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/.exec(href)
  if (!m) return null
  const coll = /[?&]collection=(\d+)/.exec(href)?.[1]
  return coll === collectionId ? m[1] : null
}

// ── Rendered post page ───────────────────────────────────────────────────────

/** The inner HTML of the element whose start tag begins at `start`. */
function innerHtmlAt(html: string, start: number): string | null {
  const open = /^<([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(html.slice(start))
  if (!open) return null
  const tag = open[1].toLowerCase()
  const bodyStart = start + open[0].length
  const re = new RegExp(`<(/?)${tag}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi")
  re.lastIndex = bodyStart
  let depth = 1
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] === "/") depth--
    else if (!m[0].endsWith("/>")) depth++
    if (depth === 0) return html.slice(bodyStart, m.index)
  }
  return null
}

/** Start index of the tag that contains attribute match position `at`. */
function tagStartBefore(html: string, at: number): number {
  return html.lastIndexOf("<", at)
}

/**
 * The post body HTML from a rendered post page: the first element whose class
 * starts with `RichText-module` inside `.patreon-post-content`.
 */
export function postBodyFromPageHtml(html: string): string | null {
  // Only inside the post-content wrapper: elsewhere a RichText block is the
  // about blurb, a tier description or a comment, never the chapter.
  const wrapper =
    /class\s*=\s*["'][^"']*\bpatreon-post-content\b/i.exec(html) ?? /data-tag\s*=\s*["']post-content["']/i.exec(html)
  if (!wrapper) return null
  const inner = innerHtmlAt(html, tagStartBefore(html, wrapper.index))
  if (inner == null) return null
  const m = /class\s*=\s*["'](?:[^"']*\s)?RichText-module/.exec(inner)
  if (!m) return null
  return innerHtmlAt(inner, tagStartBefore(inner, m.index))
}

/** The post title from `[data-tag="post-title"]`, as plain text. */
export function postTitleFromPageHtml(html: string): string | null {
  const m = /data-tag\s*=\s*["']post-title["']/i.exec(html)
  if (!m) return null
  const inner = innerHtmlAt(html, tagStartBefore(html, m.index))
  if (inner == null) return null
  const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()
  return text || null
}
