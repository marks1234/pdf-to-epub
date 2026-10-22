/**
 * Reading the live collection page: post links, the "Load more" control, and
 * the page metadata. Every function takes its root, so tests can pass a fake.
 */
import { sleep } from "./http"
import { acceptCoverUrl, postIdFromHref, postIdOf } from "./page-parse"

const CHROME = "header, nav, aside, footer"

/** Post ids tagged with this collection (`?collection=`), in page order. */
export function visiblePostIds(collectionId: string, root: ParentNode = document): string[] {
  const ids: string[] = []
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href*="/posts/"]')) {
    const id = postIdFromHref(a.href, collectionId)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * Post ids on the page: the tagged ones when any exist; otherwise untagged
 * post links from the deepest container holding at least 80% of them, outside
 * the site header / nav / sidebars / footer.
 */
export function pagePostIds(collectionId: string, root: ParentNode = document): { ids: string[]; source: "page" | "page-untagged" } {
  const tagged = visiblePostIds(collectionId, root)
  if (tagged.length) return { ids: tagged, source: "page" }
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/posts/"]')].filter(
    (a) => !a.closest(CHROME) && postIdOf(a.href),
  )
  let pool = links
  for (let node = links[0]?.parentElement; node; node = node.parentElement) {
    const inside = links.filter((a) => node.contains(a))
    if (inside.length >= 0.8 * links.length) {
      pool = inside
      break
    }
  }
  const ids: string[] = []
  for (const a of pool) {
    const id = postIdOf(a.href)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return { ids, source: "page-untagged" }
}

const LOCALIZED_MORE = new Set([
  "mehr laden", "mehr anzeigen", "weitere laden", "cargar más", "ver más", "mostrar más", "voir plus", "charger plus",
  "afficher plus", "carica altri", "mostra altri", "carregar mais", "ver mais", "meer laden", "meer weergeven",
  "załaduj więcej", "pokaż więcej", "показать ещё", "показать еще", "загрузить ещё", "もっと見る", "더 보기",
])

/** The "Load more" control, if a visible, enabled one exists. */
export function findLoadMore(root: ParentNode = document): HTMLElement | null {
  for (const b of root.querySelectorAll<HTMLElement>('button, [role="button"], a:not([href]), a[href="#"]')) {
    if ((b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true") continue
    if (b.getClientRects().length === 0) continue
    const meta = `${b.getAttribute("data-tag") ?? ""} ${b.getAttribute("aria-label") ?? ""}`
    const text = (b.textContent ?? "").replace(/\s+/g, " ").trim()
    if (/load[-_ ]?more|show[-_ ]?more/i.test(meta) || /^(load|show|see|view)\s+more\b/i.test(text) || LOCALIZED_MORE.has(text.toLowerCase())) {
      return b
    }
  }
  return null
}

/**
 * Last-resort listing: click "Load more" (or, failing that, scroll the last
 * post into view) until no new post links appear or `expected` is reached.
 */
export async function harvestPage(
  collectionId: string,
  signal: AbortSignal,
  onCount: (n: number) => void,
  expected?: number,
): Promise<{ ids: string[]; source: "page" | "page-untagged" }> {
  let found = pagePostIds(collectionId)
  const startY = window.scrollY
  let stalls = 0
  try {
    for (let round = 0; round < 100 && stalls < 2; round++) {
      if (expected && found.ids.length >= expected) break
      const button = findLoadMore()
      if (button) button.click()
      else {
        const links = document.querySelectorAll<HTMLElement>('a[href*="/posts/"]')
        const last = links[links.length - 1]
        if (!last) break
        last.scrollIntoView({ block: "end" })
      }
      const before = found.ids.length
      // Wait up to ~10s for new links to render.
      for (let t = 0; t < 20; t++) {
        await sleep(500, signal)
        found = pagePostIds(collectionId)
        if (found.ids.length > before) break
      }
      stalls = found.ids.length > before ? 0 : stalls + 1
      onCount(found.ids.length)
      await sleep(600 + Math.random() * 300, signal)
    }
  } finally {
    window.scrollTo(0, startY)
  }
  if (found.source === "page-untagged" && expected && found.ids.length > expected) {
    found = { ...found, ids: found.ids.slice(0, expected) }
  }
  return found
}

const meta = (doc: Document, property: string) =>
  doc.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content || undefined

/**
 * og:title / og:image, but only when the page's og:url or canonical link is
 * this collection (an SPA can leave a previous page's tags behind).
 */
export function trustedOg(doc: Document, collectionId: string): { title?: string; image?: string } {
  const url = meta(doc, "og:url") ?? doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? ""
  if (!url.includes(`/collection/${collectionId}`) && !new RegExp(`/collection/[^/?#]*-${collectionId}\\b`).test(url)) return {}
  const image = meta(doc, "og:image")
  return { title: meta(doc, "og:title"), image: acceptCoverUrl(image) ? image : undefined }
}
