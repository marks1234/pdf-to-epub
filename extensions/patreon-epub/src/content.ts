/**
 * Content script for https://www.patreon.com/collection/* — lists the
 * collection, fetches each post the user can read, and saves one EPUB.
 */
import type { Chapter } from "@/lib/epub-book"
import { downloadBlob } from "@/lib/download"
import { sanitizeFilename } from "@/lib/format"

import { isJpegOrPng, postToChapter } from "./build"
import { createHttp, isAbort, sleep, type Http } from "./http"
import { collectionIdFromPath, parseCollectionDocTitle, postIdFromHref } from "./page-parse"
import { listCollection, orderOldestFirst, ORIGIN, type Listing, type PostRef } from "./patreon-api"
import { fetchPostContent, type PostResult } from "./posts"
import { buildWithFallback, SandboxBuilder } from "./sandbox-client"
import { Panel, type Skipped } from "./ui"

interface State {
  collectionId: string
  bookTitle: string
  author: string
  description?: string
  coverUrls: string[]
  posts: PostRef[]
  listing?: Listing
  /** Fetched posts survive a cancel, so a restart doesn't refetch them. */
  cache: Map<string, PostResult>
  abort?: AbortController
  lastBook?: { blob: Blob; filename: string }
}

let state: State | null = null
let panel: Panel | null = null
let sandbox: SandboxBuilder | null = null

// ── Page reading ─────────────────────────────────────────────────────────────

function visiblePostIds(collectionId: string): string[] {
  const ids: string[] = []
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/posts/"]')) {
    const id = postIdFromHref(a.href, collectionId)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function findLoadMore(): HTMLButtonElement | null {
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) {
    if (b.textContent?.trim().toLowerCase() === "load more" && !b.disabled) return b
  }
  return null
}

/** Last-resort listing: click "Load more" until no new post links appear. */
async function harvestPage(collectionId: string, signal: AbortSignal, onCount: (n: number) => void): Promise<string[]> {
  let ids = visiblePostIds(collectionId)
  let stalls = 0
  for (let round = 0; round < 100 && stalls < 2; round++) {
    const button = findLoadMore()
    if (!button) break
    button.click()
    const before = ids.length
    // Wait up to ~10s for new links to render.
    for (let t = 0; t < 20; t++) {
      await sleep(500, signal)
      ids = visiblePostIds(collectionId)
      if (ids.length > before) break
    }
    stalls = ids.length > before ? 0 : stalls + 1
    onCount(ids.length)
    await sleep(600 + Math.random() * 300, signal)
  }
  return ids
}

function metaContent(property: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content || undefined
}

// ── Flow ─────────────────────────────────────────────────────────────────────

async function openPanel(): Promise<void> {
  if (!panel || !state) return
  if (state.posts.length > 0) return showReady()
  const abort = new AbortController()
  state.abort = abort
  panel.showBusy("Listing chapters…")
  const st = state
  try {
    const http = createHttp({ signal: abort.signal })
    // The SPA may have set the title after mount; re-read it now.
    const info = parseCollectionDocTitle(document.title)
    if (info.title) st.bookTitle = info.title
    if (info.creator) st.author = info.creator
    const listing = await listCollection(st.collectionId, {
      fetchJson: (url) => http.getJson(url),
      harvestPage: () => harvestPage(st.collectionId, abort.signal, (n) => panel?.showBusy(`Loading the list… ${n} posts so far`)),
      visibleIds: visiblePostIds(st.collectionId),
      expectedCount: info.postCount,
      onStep: (m) => panel?.showBusy(m),
    })
    st.listing = listing
    st.posts = orderOldestFirst(listing.posts, listing.order)
    if (listing.collection?.title) st.bookTitle = listing.collection.title
    if (listing.collection?.creator && !info.creator) st.author = listing.collection.creator
    if (listing.collection?.description) st.description = listing.collection.description
    if (listing.collection?.coverUrl) st.coverUrls.unshift(listing.collection.coverUrl)
    showReady()
  } catch (e) {
    if (isAbort(e)) return panel.showButton()
    panel.showError(e instanceof Error ? e.message : String(e), () => void openPanel())
  }
}

function showReady(): void {
  if (!panel || !state) return
  const note =
    state.listing?.source === "page"
      ? "Listed from the page (the API listing was unavailable); order is fixed by publish date after fetching."
      : undefined
  panel.showReady(
    state.bookTitle,
    state.posts.map((p) => ({ label: p.title || `Post ${p.id}` })),
    note,
  )
  // Warm up the builder frame while the user picks a range.
  void sandbox?.ready()
}

async function fetchCover(http: Http, urls: string[]): Promise<ArrayBuffer | undefined> {
  for (const url of urls) {
    try {
      const bytes = await http.getBytes(url)
      if (isJpegOrPng(bytes)) return bytes
    } catch (e) {
      if (isAbort(e)) throw e
    }
  }
  return undefined
}

async function start(from: number, to: number): Promise<void> {
  if (!panel || !state || !sandbox) return
  const st = state
  const selected = st.posts.slice(from, to + 1)
  const abort = new AbortController()
  st.abort = abort
  const http = createHttp({ signal: abort.signal })
  panel.showProgress()

  try {
    const fetched: PostResult[] = []
    for (let i = 0; i < selected.length; i++) {
      const ref = selected[i]
      const label = ref.title || `Post ${ref.id}`
      panel.setProgress(i, selected.length, `Fetching ${i + 1} / ${selected.length} — ${label}`)
      let result = st.cache.get(ref.id)
      if (!result) {
        result = await fetchPostContent(ref, http)
        // Only cache successes: a transient failure should be retried next run.
        if (result.ok) st.cache.set(ref.id, result)
      }
      fetched.push(result)
    }

    // A page-harvested listing had no dates up front; order by what we learned.
    let ordered = fetched
    if (st.listing?.order === "newest-first") {
      const refs = orderOldestFirst(
        fetched.map((r) => ({ id: r.id, title: r.title, publishedAt: r.ok ? r.publishedAt : undefined })),
        "newest-first",
      )
      const byId = new Map(fetched.map((r) => [r.id, r]))
      ordered = refs.map((r) => byId.get(r.id) as PostResult)
    }

    const chapters: Chapter[] = []
    const skipped: Skipped[] = []
    for (const r of ordered) {
      if (!r.ok) {
        skipped.push({ title: r.title, reason: r.reason })
        continue
      }
      const chapter = postToChapter(r, st.bookTitle)
      if (chapter) chapters.push(chapter)
      else skipped.push({ title: r.title, reason: "no text in the post body" })
    }
    if (chapters.length === 0) {
      panel.showError("None of the selected posts had readable text — nothing to save.", () => showReady())
      return
    }

    panel.setProgress(selected.length, selected.length, "Fetching cover…")
    const cover = await fetchCover(http, st.coverUrls)
    panel.setProgress(selected.length, selected.length, "Building EPUB…")

    const full = from === 0 && to === st.posts.length - 1
    const firstLabel = chapters[0].title
    const lastLabel = chapters[chapters.length - 1].title
    const { blob, coverDropped } = await buildWithFallback(sandbox, {
      title: st.bookTitle,
      author: st.author,
      identifier: `patreon-collection-${st.collectionId}`,
      description: [st.description, `${firstLabel} – ${lastLabel}`].filter(Boolean).join("\n\n"),
      notes: `Compiled from Patreon collection ${st.collectionId} (${chapters.length} chapters) on ${new Date().toISOString().slice(0, 10)}, for personal offline reading.`,
      cover,
      chapters,
    })

    const stem = sanitizeFilename(full ? st.bookTitle : `${st.bookTitle} (${from + 1}-${to + 1})`)
    const filename = `${stem}.epub`
    st.lastBook = { blob, filename }
    downloadBlob(blob, filename, "application/epub+zip")

    const notes: string[] = []
    if (!cover) notes.push("No cover image could be fetched; the book has none.")
    if (coverDropped) notes.push("The cover image was rejected by the EPUB builder and left out.")
    panel.showDone(filename, chapters.length, skipped, notes)
  } catch (e) {
    if (isAbort(e)) return showReady()
    panel.showError(e instanceof Error ? e.message : String(e), () => showReady())
  }
}

// ── Mount / SPA navigation ───────────────────────────────────────────────────

function mount(): void {
  const collectionId = collectionIdFromPath(location.pathname)
  if (!collectionId) return
  const info = parseCollectionDocTitle(document.title || metaContent("og:title") || "")
  const og = metaContent("og:image")
  state = {
    collectionId,
    bookTitle: info.title || `Patreon collection ${collectionId}`,
    author: info.creator || "Unknown",
    coverUrls: og && og.startsWith(`${ORIGIN}/`) ? [og] : [],
    posts: [],
    cache: new Map(),
  }
  panel = new Panel({
    onOpen: () => void openPanel(),
    onStart: (from, to) => void start(from, to),
    onCancel: () => state?.abort?.abort(),
    onDownloadAgain: () => {
      if (state?.lastBook) downloadBlob(state.lastBook.blob, state.lastBook.filename, "application/epub+zip")
    },
  })
  sandbox = new SandboxBuilder(panel.root)
}

function unmount(): void {
  state?.abort?.abort()
  panel?.destroy()
  panel = null
  state = null
  sandbox = null
}

// Patreon is a single-page app: follow client-side navigation between pages.
let lastPath = ""
function sync(): void {
  if (location.pathname === lastPath) return
  lastPath = location.pathname
  const id = collectionIdFromPath(location.pathname)
  if (state && state.collectionId === id) return
  unmount()
  if (id) mount()
}

sync()
setInterval(sync, 1000)
