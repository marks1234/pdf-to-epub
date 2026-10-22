/**
 * Content script for https://www.patreon.com/collection/* — lists the
 * collection, fetches each post the user can read, and saves one EPUB.
 */
import type { Chapter } from "@/lib/epub-book"

import { bookFilename, buildBook, isJpegOrPng, postToChapter } from "./build"
import * as diag from "./diag"
import { createHttp, isAbort, type Http } from "./http"
import { harvestPage, trustedOg, visiblePostIds } from "./page-dom"
import { acceptCoverUrl, collectionIdFromPath, parseCollectionDocTitle } from "./page-parse"
import { listCollection, orderOldestFirst, type Listing, type PostRef } from "./patreon-api"
import * as postCache from "./post-cache"
import type { PostResult } from "./posts"
import { createPool, fetchAll, orderResults } from "./run"
import { Panel, type Skipped } from "./ui"

interface State {
  collectionId: string
  bookTitle: string
  author: string
  description?: string
  coverUrls: string[]
  posts: PostRef[]
  listing?: Listing
  /** Fetched posts survive a cancel, halt or navigation, so a restart doesn't refetch them. */
  cache: Map<string, PostResult>
  abort?: AbortController
  running?: "listing" | "fetching"
  listingPromise?: Promise<void>
  lastRange?: [number, number]
  lastBook?: { blob: Blob; filename: string }
}

/** One session per collection, so Back / re-opening keeps the listing and fetched posts. */
const sessions = new Map<string, State>()
const MAX_SESSIONS = 3
let state: State | null = null
let panel: Panel | null = null
/** The collection whose posts are being fetched (at most one at a time). */
let activeFetch: State | null = null
/** Navigation happened during a fetch: swap panels once it ends. */
let pendingUnmount = false

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function onBeforeUnload(e: BeforeUnloadEvent): void {
  e.preventDefault()
  e.returnValue = ""
}

function addCover(st: State, url: string | undefined, first = false): void {
  if (!acceptCoverUrl(url) || st.coverUrls.includes(url)) return
  if (first) st.coverUrls.unshift(url)
  else st.coverUrls.push(url)
}

// ── Flow ─────────────────────────────────────────────────────────────────────

async function openPanel(): Promise<void> {
  const st = state
  const p = panel
  if (!st || !p || st.running) return
  if (st.posts.length > 0) return showReady(st, p)

  // Metadata is read now, not at mount: the SPA sets title / og tags late.
  const info = parseCollectionDocTitle(document.title)
  const og = trustedOg(document, st.collectionId)
  const ogInfo = og.title ? parseCollectionDocTitle(og.title) : {}
  if (info.title ?? ogInfo.title) st.bookTitle = (info.title ?? ogInfo.title) as string
  if (info.creator ?? ogInfo.creator) st.author = (info.creator ?? ogInfo.creator) as string
  addCover(st, og.image)

  const abort = new AbortController()
  st.abort = abort
  st.running = "listing"
  const live = () => !abort.signal.aborted && st.abort === abort
  p.showBusy("Listing chapters…")
  diag.log(`listing collection ${st.collectionId}`)
  const run = async () => {
    try {
      const http = createHttp({ signal: abort.signal, onAttempt: diag.logAttempt, onJson: diag.logShape })
      const listing = await listCollection(st.collectionId, {
        fetchJson: (url) => http.getJson(url),
        harvestPage: (expected) =>
          harvestPage(st.collectionId, abort.signal, (n) => live() && p.showBusy(`Loading the list… ${n} posts so far`), expected),
        visibleIds: visiblePostIds(st.collectionId),
        expectedCount: info.postCount ?? ogInfo.postCount,
        onStep: (m) => live() && p.showBusy(m),
        log: diag.log,
      })
      if (!live()) return
      st.listing = listing
      st.posts = orderOldestFirst(listing.posts, listing.order)
      const c = listing.collection
      if (c?.title) st.bookTitle = c.title
      if (c?.creator && !info.creator) st.author = c.creator
      if (c?.description) st.description = c.description
      addCover(st, c?.coverUrl, true)
      // Chapters saved by an earlier visit: one storage read, merged up front.
      for (const [id, r] of await postCache.getMany(st.posts.map((x) => x.id))) if (!st.cache.has(id)) st.cache.set(id, r)
      if (live()) showReady(st, p)
    } catch (e) {
      if (isAbort(e) || !live()) return void (st.abort === abort && p.showButton())
      diag.log(`listing error: ${errMsg(e)}`)
      p.showError(errMsg(e), () => void openPanel())
    } finally {
      if (st.abort === abort) st.running = undefined
    }
  }
  st.listingPromise = run().finally(() => (st.listingPromise = undefined))
  return st.listingPromise
}

function showReady(st: State, p: Panel): void {
  const l = st.listing
  const note =
    l?.source === "page" || l?.source === "page-untagged"
      ? "Listed from the page (the API listing was unavailable); order is fixed by publish date after fetching."
      : undefined
  const warnings: string[] = []
  if (l?.incomplete) {
    warnings.push(
      `Found ${l.incomplete.found}${l.incomplete.expected ? ` of ${l.incomplete.expected}` : ""} posts — the book may be incomplete.`,
    )
    for (const n of l.notes ?? []) warnings.push(n)
  } else if (l?.source === "page-untagged") {
    warnings.push(...(l.notes ?? []))
  }
  const saved = st.posts.filter((x) => st.cache.get(x.id)?.ok).length
  p.showReady(
    st.bookTitle,
    st.posts.map((x) => ({ label: `${x.title || `Post ${x.id}`}${x.canView === false ? " (locked)" : ""}` })),
    note,
    {
      saved,
      onClearSaved: () => {
        void postCache.clear()
        st.cache.clear()
        showReady(st, p)
      },
      warnings,
      range: st.lastRange,
    },
  )
}

async function fetchCover(http: Http, urls: string[]): Promise<ArrayBuffer | undefined> {
  for (const url of urls) {
    try {
      const bytes = await http.getBytes(url)
      if (isJpegOrPng(bytes)) return bytes
      diag.log(`cover ${diag.describeUrl(url)}: not JPEG/PNG`)
    } catch (e) {
      if (isAbort(e)) throw e
      diag.log(`cover ${diag.describeUrl(url)}: ${errMsg(e)}`)
    }
  }
  return undefined
}

const fmtWait = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

async function start(from: number, to: number): Promise<void> {
  const st = state
  const p = panel
  if (!st || !p || st.running) return
  if (activeFetch && activeFetch !== st) return p.showError("Finish or cancel the current book first.")
  st.running = "fetching"
  activeFetch = st
  st.lastRange = [from, to]
  const abort = new AbortController()
  st.abort = abort
  const stale = () => void (st.abort === abort && showReady(st, p))
  addEventListener("beforeunload", onBeforeUnload)
  // Up to 3 posts in flight, request starts at least ~250 ms apart; one 429/503
  // drops the pool to 1, and 20 successes in a row win a slot back.
  const pool = createPool(3)
  const http = createHttp({
    signal: abort.signal,
    concurrency: pool.max,
    minDelayMs: 250,
    maxDelayMs: 350,
    onWait: (ms) => {
      pool.rateLimited()
      p.setPause(`Patreon asked us to slow down — resuming in ${fmtWait(ms)}`)
    },
    onAttempt: diag.logAttempt,
    onJson: diag.logShape,
  })
  const selected = st.posts.slice(from, to + 1)
  diag.log(`start ${from + 1}-${to + 1} of ${st.posts.length}`)
  p.showProgress()
  let phase = "while fetching posts"

  try {
    const missing = selected.map((r) => r.id).filter((id) => !st.cache.has(id))
    for (const [id, r] of await postCache.getMany(missing)) st.cache.set(id, r)

    const { results, halted } = await fetchAll(selected, {
      http,
      cache: st.cache,
      signal: abort.signal,
      pool,
      onProgress: (done, total, label) => p.setProgress(done, total, `Fetched ${done} / ${total} — ${label}`),
      onPause: (m) => p.setPause(m),
      onResult: (r) => void postCache.put(r),
      log: diag.log,
    })
    if (halted) {
      const kept = results.filter((r) => r.ok).length
      diag.log(`halted (${halted.kind}) at ${halted.index}`)
      p.showError(
        `Stopped at ${halted.index + 1}/${selected.length}: ${halted.message}. ${kept} chapters fetched and kept — Retry resumes from here.`,
        () => void start(from, to).catch((e) => console.error("[patreon-epub]", e)),
      )
      return
    }

    phase = "while preparing chapters"
    const chapters: Chapter[] = []
    const skipped: Skipped[] = []
    orderResults(results, st.listing?.order ?? "collection").forEach((r, i) => {
      if (!r.ok) return void skipped.push({ title: r.title, reason: r.reason, kind: r.kind })
      try {
        const chapter = postToChapter(r, st.bookTitle)
        if (chapter) chapters.push(chapter)
        else skipped.push({ title: r.title, reason: "no text in the post body", kind: "empty" })
      } catch (e) {
        diag.log(`convert error at chapter ${i} (post ${r.id}): ${errMsg(e)}`)
        skipped.push({ title: r.title, reason: `could not convert (post ${r.id}): ${errMsg(e)}`, kind: "empty" })
      }
    })
    if (chapters.length === 0) {
      p.showError("None of the selected posts had readable text — nothing to save.", () => showReady(st, p))
      return
    }

    phase = "while fetching the cover"
    p.setProgress(selected.length, selected.length, "Fetching cover…")
    const cover = await fetchCover(http, st.coverUrls)
    if (abort.signal.aborted) return stale()

    phase = "while building the EPUB"
    p.setProgress(selected.length, selected.length, "Building EPUB…")
    const full = from === 0 && to === st.posts.length - 1
    const { blob, coverDropped } = await buildBook({
      title: st.bookTitle,
      author: st.author,
      identifier: `patreon-collection-${st.collectionId}`,
      description: [st.description, `${chapters[0].title} – ${chapters[chapters.length - 1].title}`].filter(Boolean).join("\n\n"),
      notes: `Compiled from Patreon collection ${st.collectionId} (${chapters.length} chapters) on ${new Date().toISOString().slice(0, 10)}, for personal offline reading.`,
      cover,
      chapters,
    })
    if (abort.signal.aborted) return stale()

    const filename = bookFilename(st.bookTitle, full ? undefined : [from + 1, to + 1])
    st.lastBook = { blob, filename }
    p.download(blob, filename)
    diag.log(`built ${chapters.length} chapters, ${skipped.length} skipped, ${blob.size} bytes`)

    const notes: string[] = []
    if (!cover) notes.push("No cover image could be fetched; the book has none.")
    if (coverDropped) notes.push("The cover image wasn't a usable JPEG/PNG and was left out.")
    p.showDone(filename, chapters.length, skipped, notes, () => void start(from, to).catch((e) => console.error("[patreon-epub]", e)))
  } catch (e) {
    if (isAbort(e)) return stale()
    diag.log(`error ${phase}: ${errMsg(e)}`)
    p.showError(`Failed ${phase}: ${errMsg(e)}`, () => showReady(st, p))
  } finally {
    if (st.abort === abort) st.running = undefined
    if (activeFetch === st) activeFetch = null
    removeEventListener("beforeunload", onBeforeUnload)
    // Navigated away mid-fetch: the result stays on screen; the next navigation swaps panels.
    if (pendingUnmount) diag.log("fetch finished after navigating away; panel kept as an overlay")
  }
}

// ── Mount / SPA navigation ───────────────────────────────────────────────────

let pruned = false

function mount(collectionId: string): void {
  if (!pruned) {
    pruned = true
    void postCache.prune()
  }
  let st = sessions.get(collectionId)
  if (!st) {
    st = {
      collectionId,
      bookTitle: `Patreon collection ${collectionId}`,
      author: "Unknown",
      coverUrls: [],
      posts: [],
      cache: new Map(),
    }
    sessions.set(collectionId, st)
    // Keep a few sessions; evict the oldest that isn't busy.
    for (const [id, s] of sessions) {
      if (sessions.size <= MAX_SESSIONS) break
      if (!s.running && s !== st) sessions.delete(id)
    }
  } else {
    // Refresh recency.
    sessions.delete(collectionId)
    sessions.set(collectionId, st)
  }
  state = st
  panel = new Panel({
    onOpen: () => void openPanel().catch((e) => console.error("[patreon-epub]", e)),
    onStart: (from, to) => void start(from, to).catch((e) => console.error("[patreon-epub]", e)),
    onCancel: () => state?.abort?.abort(),
    onDownloadAgain: () => {
      if (state?.lastBook) panel?.download(state.lastBook.blob, state.lastBook.filename)
    },
    diagnostics: diag.text,
  })
}

function unmount(): void {
  // A listing needs this collection's DOM; a fetch never reaches here (see sync).
  if (state?.running === "listing") state.abort?.abort()
  panel?.destroy()
  panel = null
  state = null
  removeEventListener("beforeunload", onBeforeUnload)
}

// Patreon is a single-page app: follow client-side navigation between pages.
let lastPath = ""
let warnedPath = false
export function sync(): void {
  // Only a real path change swaps panels; a finished overlay stays until then.
  if (location.pathname === lastPath) return
  lastPath = location.pathname
  const id = collectionIdFromPath(location.pathname)
  if (!id && !warnedPath && location.pathname.includes("/collection")) {
    warnedPath = true
    console.debug("[patreon-epub] collection path without an id:", location.pathname)
    diag.log("collection path without a parsable id")
  }
  if (state && state.collectionId === id) {
    pendingUnmount = false
    return
  }
  // A running fetch keeps its panel as an overlay and finishes with it.
  if (state?.running === "fetching") {
    pendingUnmount = true
    return
  }
  pendingUnmount = false
  unmount()
  if (id) mount(id)
}

sync()
setInterval(sync, 1000)
