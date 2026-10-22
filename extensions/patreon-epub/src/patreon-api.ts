/**
 * Patreon JSON:API: URL builders, response parsing, and chapter ordering.
 *
 * Pure (no fetch, no DOM) so pagination and ordering are unit-tested with
 * synthetic responses. The endpoints are Patreon's own web-app API — the same
 * calls the site makes for a logged-in patron — so they only ever return what
 * the user's account can already read.
 */
import type { Block } from "@/lib/reconstruct"
import { extractNumber } from "@/lib/sequence"

import { HttpError, isAbort, NotJsonError } from "./http"
import { prosemirrorJsonToBlocks } from "./prosemirror-to-blocks"

export const ORIGIN = "https://www.patreon.com"

/** A post in the collection listing. Everything but the id is optional. */
export interface PostRef {
  id: string
  title?: string
  publishedAt?: string
  url?: string
  /** `current_user_can_view` from the listing, when present. */
  canView?: boolean
}

export interface ListPage {
  posts: PostRef[]
  /** Absolute URL of the next page, or null on the last page. */
  next: string | null
  /** A next link/cursor was present but could not be followed safely. */
  nextRejected?: boolean
}

export interface CollectionInfo {
  title?: string
  description?: string
  postCount?: number
  /** Post IDs in the collection's own order, when the API exposes them. */
  postIds: string[]
  /** Post details from `included`, keyed by id order of `postIds` where known. */
  posts: PostRef[]
  coverUrl?: string
  creator?: string
}

/** One post's content, as the API returned it. */
export interface PostContent {
  id: string
  title?: string
  html: string | null
  /** From `content_json_string` when `content` is empty (Patreon's newer editor). */
  blocks?: Block[]
  publishedAt?: string
  /** `current_user_can_view`, when the API reports it. */
  canView?: boolean
}

// ── URLs ─────────────────────────────────────────────────────────────────────

const LIST_FIELDS = "title,published_at,url,current_user_can_view"

export function postsListUrl(collectionId: string, withSort: boolean, pageSize?: number): string {
  const q = new URLSearchParams()
  q.set("filter[collection_id]", collectionId)
  if (withSort) q.set("sort", "collection_order")
  if (pageSize) q.set("page[count]", String(pageSize))
  q.set("fields[post]", LIST_FIELDS)
  q.set("json-api-version", "1.0")
  return `${ORIGIN}/api/posts?${q}`
}

export function collectionUrl(collectionId: string): string {
  const q = new URLSearchParams()
  q.set("include", "posts,campaign")
  q.set("fields[post]", LIST_FIELDS)
  q.set("json-api-version", "1.0")
  return `${ORIGIN}/api/collection/${collectionId}?${q}`
}

export function postUrl(postId: string): string {
  const q = new URLSearchParams()
  q.set("fields[post]", "title,content,content_json_string,published_at,current_user_can_view")
  q.set("json-api-version", "1.0")
  return `${ORIGIN}/api/posts/${postId}?${q}`
}

export function postPageUrl(postId: string): string {
  return `${ORIGIN}/posts/${postId}`
}

// ── Parsing ──────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const idOf = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined

export class ApiShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ApiShapeError"
  }
}

/** A listing that can't be this collection (filter ignored) or was cut short. */
export class ImplausibleListing extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImplausibleListing"
  }
}

function postRefFrom(resource: Json): PostRef | null {
  const id = idOf(resource.id)
  if (!id) return null
  const a = isObj(resource.attributes) ? resource.attributes : {}
  const ref: PostRef = { id, title: str(a.title), publishedAt: str(a.published_at), url: str(a.url) }
  if (typeof a.current_user_can_view === "boolean") ref.canView = a.current_user_can_view
  return ref
}

/**
 * Resolve a pagination link against the site origin. Only Patreon links are
 * followed (`patreon.com` is rewritten to `www.patreon.com`) — a response can
 * never send the content script elsewhere.
 */
export function resolveSameOrigin(link: string, base = ORIGIN): string | null {
  try {
    const u = new URL(link, base)
    if (u.protocol === "https:" && u.hostname === "patreon.com") u.hostname = "www.patreon.com"
    return u.origin === ORIGIN ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * One page of `/api/posts`. The next page comes from `links.next` (a string or
 * `{href}`), or from a cursor (`links.next.cursor`, `meta.pagination.cursors.next`,
 * `meta.pagination.next`, `meta.next_cursor`) applied to the current URL as
 * `page[cursor]`.
 */
export function parsePostListPage(json: unknown, currentUrl: string): ListPage {
  if (!isObj(json) || !Array.isArray(json.data)) throw new ApiShapeError("Listing response has no data array.")
  const posts = json.data
    .filter(isObj)
    .filter((r) => r.type === undefined || r.type === "post")
    .map(postRefFrom)
    .filter((p): p is PostRef => p !== null)

  const links = isObj(json.links) ? json.links : {}
  const meta = isObj(json.meta) ? json.meta : {}
  const pagination = isObj(meta.pagination) ? meta.pagination : {}
  const cursors = isObj(pagination.cursors) ? pagination.cursors : {}
  const looksLikeLink = (s: string | undefined) => !!s && /^(https?:)?\/|^\?/.test(s)

  let link = typeof links.next === "string" ? str(links.next) : isObj(links.next) ? str(links.next.href) : undefined
  let cursor = isObj(links.next) ? str(links.next.cursor) : undefined
  if (!link && !cursor) {
    const c = str(cursors.next) ?? str(pagination.next) ?? str(meta.next_cursor)
    if (looksLikeLink(c)) link = c
    else cursor = c
  }

  let next: string | null = null
  let nextRejected = false
  if (link) {
    next = resolveSameOrigin(link, currentUrl)
    nextRejected = next === null
  } else if (cursor) {
    const u = new URL(currentUrl)
    u.searchParams.set("page[cursor]", cursor)
    next = resolveSameOrigin(u.toString())
    nextRejected = next === null
  }
  if (next === currentUrl) next = null
  return nextRejected ? { posts, next, nextRejected } : { posts, next }
}

/** `/api/collection/{id}`: title, ordered post IDs, included posts, cover. */
export function parseCollection(json: unknown): CollectionInfo {
  if (!isObj(json) || !isObj(json.data)) throw new ApiShapeError("Collection response has no data object.")
  const data = json.data
  const a = isObj(data.attributes) ? data.attributes : {}
  const included = Array.isArray(json.included) ? json.included.filter(isObj) : []

  // Order: attributes.post_ids, else relationships.posts.data.
  let postIds: string[] = Array.isArray(a.post_ids) ? a.post_ids.map(idOf).filter((x): x is string => !!x) : []
  const rel = isObj(data.relationships) ? data.relationships : {}
  if (postIds.length === 0 && isObj(rel.posts) && Array.isArray(rel.posts.data)) {
    postIds = rel.posts.data.filter(isObj).map((r) => idOf(r.id)).filter((x): x is string => !!x)
  }

  const includedPosts = included
    .filter((r) => r.type === "post")
    .map(postRefFrom)
    .filter((p): p is PostRef => p !== null)
  const byId = new Map(includedPosts.map((p) => [p.id, p]))
  if (postIds.length === 0) postIds = includedPosts.map((p) => p.id)
  postIds = [...new Set(postIds)]
  const posts = postIds.map((id) => byId.get(id) ?? { id })

  const thumb = isObj(a.thumbnail) ? a.thumbnail : {}
  const coverUrl =
    str(thumb.large) ?? str(thumb.original) ?? str(thumb.default) ?? str(thumb.url) ??
    (typeof a.thumbnail === "string" ? a.thumbnail : undefined) ?? str(a.image_url)

  const campaign = included.find((r) => r.type === "campaign")
  const campaignAttrs = campaign && isObj(campaign.attributes) ? campaign.attributes : {}
  const creator = str(campaignAttrs.name) ?? str(campaignAttrs.vanity)

  return {
    title: str(a.title),
    description: str(a.description),
    postCount: typeof a.num_posts === "number" ? a.num_posts : undefined,
    postIds,
    posts,
    coverUrl,
    creator,
  }
}

/** `/api/posts/{id}`. `html` is null when the API sends no body (locked post). */
export function parsePost(json: unknown): PostContent {
  if (!isObj(json) || !isObj(json.data)) throw new ApiShapeError("Post response has no data object.")
  const id = idOf(json.data.id)
  if (!id) throw new ApiShapeError("Post response has no id.")
  const a = isObj(json.data.attributes) ? json.data.attributes : {}
  const content = typeof a.content === "string" && a.content.trim() ? a.content : null
  // Patreon now often sends `content: null` and the text only as a TipTap doc.
  const blocks =
    !content && typeof a.content_json_string === "string" ? prosemirrorJsonToBlocks(a.content_json_string) : null
  return {
    id,
    title: str(a.title),
    html: content,
    ...(blocks ? { blocks } : {}),
    publishedAt: str(a.published_at),
    canView: typeof a.current_user_can_view === "boolean" ? a.current_user_can_view : undefined,
  }
}

// ── Listing with fallbacks ───────────────────────────────────────────────────

/** How a listing is ordered, which decides how it is normalized. */
export type ListingOrder = "collection" | "unordered" | "newest-first"

export interface Listing {
  posts: PostRef[]
  order: ListingOrder
  /** Which strategy produced it, for the UI and for debugging. */
  source: "posts-api" | "posts-api-unsorted" | "collection-api" | "page" | "page-untagged"
  /** Collection metadata, when the collection endpoint answered. */
  collection?: CollectionInfo
  /** Set when the best listing is shorter than expected or was cut short. */
  incomplete?: { found: number; expected?: number }
  /** What went wrong along the way (strategy errors), for the UI and diagnostics. */
  notes?: string[]
  /** The crawl stopped with a next link it couldn't follow. */
  truncated?: boolean
}

export interface ListingDeps {
  fetchJson(url: string): Promise<unknown>
  /** Post IDs harvested from the collection page itself, newest first. */
  harvestPage(expected?: number): Promise<string[] | { ids: string[]; source: "page" | "page-untagged" }>
  /** IDs already visible on the page; a listing must overlap them to be trusted. */
  visibleIds: string[]
  /** Expected post count (from the page title), if known. */
  expectedCount?: number
  /** Called as each strategy starts, for progress messages. */
  onStep?(message: string): void
  /** Diagnostics. */
  log?(line: string): void
  /** Safety cap on pages followed. */
  maxPages?: number
  /** First-page size to ask for. */
  pageSize?: number
}

/**
 * Is an API listing believable for this collection? Guards against a filter the
 * API silently ignored (which would return the user's whole feed): it must not
 * be empty, must overlap the post links already on the page, and must not be
 * wildly larger than the page says the collection is.
 */
export function plausibleListing(posts: PostRef[], visibleIds: string[], expectedCount?: number): boolean {
  if (posts.length === 0) return false
  if (visibleIds.length > 0) {
    const ids = new Set(posts.map((p) => p.id))
    if (!visibleIds.some((id) => ids.has(id))) return false
  }
  if (expectedCount && tooMany(posts.length, expectedCount)) return false
  return true
}

const tooMany = (n: number, expected: number) => n > expected + Math.max(5, expected * 0.1)

/** HTTP status of an error, from HttpError or an "HTTP 400" message. */
function statusOf(e: unknown): number | undefined {
  if (e instanceof HttpError) return e.status
  const m = /\bHTTP (\d{3})\b/.exec(errText(e))
  return m ? Number(m[1]) : undefined
}

function isTransientError(e: unknown): boolean {
  const s = statusOf(e)
  if (s !== undefined) return s === 408 || s === 429 || s >= 500
  return !(e instanceof ApiShapeError || e instanceof ImplausibleListing || e instanceof NotJsonError || isAbort(e))
}

async function listViaPostsApi(
  collectionId: string,
  withSort: boolean,
  deps: ListingDeps,
  expected: number | undefined,
): Promise<{ posts: PostRef[]; truncated: boolean }> {
  const maxPages = deps.maxPages ?? (expected ? Math.ceil((expected * 1.1) / 10) + 3 : 60)
  let pageSize = deps.pageSize ?? 100
  const posts: PostRef[] = []
  const seen = new Set<string>()
  let url: string | null = postsListUrl(collectionId, withSort, pageSize || undefined)
  let retriedTransient = false
  let truncated = false
  let page = 0
  while (url) {
    if (page >= maxPages) throw new ImplausibleListing(`still more pages after ${maxPages}`)
    let parsed: ListPage
    try {
      parsed = parsePostListPage(await deps.fetchJson(url), url)
    } catch (e) {
      if (isAbort(e)) throw e
      const s = statusOf(e)
      if (page === 0 && pageSize && (s === 400 || s === 422)) {
        deps.log?.(`posts api: page[count] rejected (${s}), retrying without it`)
        pageSize = 0
        url = postsListUrl(collectionId, withSort)
        continue
      }
      if (!retriedTransient && isTransientError(e)) {
        retriedTransient = true
        deps.log?.(`posts api: transient error on page ${page} (${errText(e)}), retrying once`)
        continue
      }
      throw e
    }
    page++
    let fresh = 0
    for (const p of parsed.posts) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      posts.push(p)
      fresh++
    }
    if (expected && tooMany(posts.length, expected)) throw new ImplausibleListing(`${posts.length}+ posts, expected ${expected}`)
    if (parsed.nextRejected) truncated = true
    // A page with nothing new means the cursor isn't advancing — stop.
    if (fresh === 0) break
    url = parsed.next
  }
  return { posts, truncated }
}

/**
 * List the collection's posts. The collection endpoint is asked first (one
 * request; its metadata names the book). If it is complete, it wins outright.
 * Otherwise the posts API (sorted, then unsorted only if the sort was
 * rejected), then the page itself. A short listing never wins silently: the
 * longest candidate is returned with `incomplete` set.
 */
export async function listCollection(collectionId: string, deps: ListingDeps): Promise<Listing> {
  const errors: string[] = []
  const log = (line: string) => deps.log?.(`listing: ${line}`)
  deps.onStep?.("Listing chapters…")

  let collection: CollectionInfo | undefined
  try {
    collection = parseCollection(await deps.fetchJson(collectionUrl(collectionId)))
    log(`collection: ${collection.postIds.length} ids, num_posts=${collection.postCount ?? "?"}`)
  } catch (e) {
    if (isAbort(e)) throw e
    errors.push(`collection: ${errText(e)}`)
    log(`collection failed: ${errText(e)}`)
  }
  const expected = deps.expectedCount ?? collection?.postCount
  const isComplete = (l: Listing) => !l.truncated && (!expected || l.posts.length >= Math.floor(expected * 0.9))
  const candidates: Listing[] = []
  const finish = (l: Listing): Listing => {
    const out: Listing = { ...l, collection }
    if (!isComplete(l)) out.incomplete = { found: l.posts.length, expected }
    if (errors.length) out.notes = errors
    log(`chose ${l.source} (${l.order}): ${l.posts.length}/${expected ?? "?"}, visible=${deps.visibleIds.length}${l.truncated ? ", truncated" : ""}`)
    return out
  }

  if (collection && plausibleListing(collection.posts, deps.visibleIds, expected)) {
    const c: Listing = { posts: collection.posts, order: "collection", source: "collection-api" }
    if (expected && collection.posts.length === expected && collection.posts.every((p) => p.title)) return finish(c)
    candidates.push(c)
  }

  const validators = deps.visibleIds.length > 0 || !!expected || (collection?.postIds.length ?? 0) > 0
  if (!validators) {
    errors.push("posts api: skipped (nothing on the page to check a listing against)")
  } else {
    for (const withSort of [true, false]) {
      const name = `posts api${withSort ? "" : " (unsorted)"}`
      if (!withSort) deps.onStep?.("Listing chapters (retrying without sort)…")
      try {
        const { posts, truncated } = await listViaPostsApi(collectionId, withSort, deps, expected)
        if (plausibleListing(posts, deps.visibleIds, expected)) {
          const l: Listing = { posts, order: withSort ? "collection" : "unordered", source: withSort ? "posts-api" : "posts-api-unsorted" }
          if (truncated) l.truncated = true
          log(`${name}: ${posts.length} posts${truncated ? " (truncated)" : ""}`)
          if (isComplete(l)) return finish(l)
          candidates.push(l)
        } else {
          errors.push(`${name}: implausible listing (${posts.length} posts)`)
          log(`${name}: implausible (${posts.length})`)
        }
        break
      } catch (e) {
        if (isAbort(e)) throw e
        errors.push(`${name}: ${errText(e)}`)
        log(`${name} failed: ${errText(e)}`)
        const s = statusOf(e)
        // Only a rejected sort is worth an unsorted pass; anything else would repeat.
        if (!(withSort && (s === 400 || s === 404 || s === 422))) break
      }
    }
  }

  const longest = () => candidates.reduce<Listing | undefined>((a, b) => (!a || b.posts.length > a.posts.length ? b : a), undefined)
  const completeOne = candidates.find(isComplete)
  if (completeOne) return finish(completeOne)

  deps.onStep?.("Reading chapter links from the page (clicking “Load more”)…")
  const harvested = await deps.harvestPage(expected)
  const { ids, source } = Array.isArray(harvested) ? { ids: harvested, source: "page" as const } : harvested
  log(`${source}: ${ids.length} ids`)
  if (ids.length > 0) {
    if (source === "page-untagged") errors.push("page: post links weren't tagged with this collection; the list may include unrelated posts")
    candidates.push({ posts: ids.map((id) => ({ id })), order: "newest-first", source })
  }
  const best = longest()
  if (!best) throw new Error(`Couldn't list this collection's posts. ${errors.join("; ")}`)
  return finish(best)
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── Ordering ─────────────────────────────────────────────────────────────────

function dateOf(p: PostRef): number | null {
  if (!p.publishedAt) return null
  const t = Date.parse(p.publishedAt)
  return Number.isNaN(t) ? null : t
}

/**
 * A sortable number for a chapter title: `Vol. 2 Ch 3` → 2e6+3, decimal
 * chapters (`12.5`) allowed, else the app's own number extraction.
 */
export function titleSortKey(title: string): number | null {
  const ch = /\b(?:ch(?:apter)?|ep(?:isode)?|part)\.?\s*#?\s*(\d+(?:\.\d+)?)/i.exec(title)
  const vol = /\b(?:vol(?:ume)?|book)\.?\s*#?\s*(\d+)/i.exec(title)
  if (ch) return (vol ? Number(vol[1]) * 1e6 : 0) + Number(ch[1])
  const bare = /(?:^|[^\d.])(\d+\.\d+)(?![\d.])/.exec(title)
  if (bare) return Number(bare[1])
  // The ".x" keeps extractNumber from treating a trailing ".5" as an extension.
  return extractNumber(`${title}.x`).num
}

function chapterNumberOf(p: PostRef): number | null {
  return p.title ? titleSortKey(p.title) : null
}

/** Rising vs falling steps between consecutive known values. */
function stepVote(values: (number | null)[]): { up: number; down: number } {
  let up = 0
  let down = 0
  let prev: number | null = null
  for (const v of values) {
    if (v === null) continue
    if (prev !== null) {
      if (v > prev) up++
      else if (v < prev) down++
    }
    prev = v
  }
  return { up, down }
}

/**
 * Does a creator-ordered list run newest first? Only when falling steps
 * outnumber rising ones by more than 2:1 — so one pinned or re-posted post
 * can't flip the book. Dates decide; chapter numbers break a tie of too few
 * or mixed dates. Default: keep the creator's order.
 */
export function looksNewestFirst(dates: (number | null)[], nums: (number | null)[]): boolean {
  for (const vote of [stepVote(dates), stepVote(nums)]) {
    if (vote.up + vote.down < 2) continue
    if (vote.down > 2 * vote.up) return true
    if (vote.up > 2 * vote.down) return false
  }
  return false
}

/**
 * Sort the items that have a key; put each keyless item right after its
 * predecessor (in `base` order) among the keyed ones.
 */
function sortKeepingNeighbours<T>(base: T[], key: (t: T) => number | null, tie: (a: T, b: T) => number): T[] {
  const keyed = base.filter((t) => key(t) !== null).sort((a, b) => (key(a) as number) - (key(b) as number) || tie(a, b))
  const after = new Map<T | null, T[]>()
  let pred: T | null = null
  for (const t of base) {
    if (key(t) !== null) pred = t
    else after.set(pred, [...(after.get(pred) ?? []), t])
  }
  const out = [...(after.get(null) ?? [])]
  for (const t of keyed) out.push(t, ...(after.get(t) ?? []))
  return out
}

/**
 * Normalize a listing to reading order (oldest first).
 *
 * - `collection` order is the creator's own order and is kept — unless it
 *   clearly runs newest-first ({@link looksNewestFirst}), then it is reversed.
 * - Otherwise: by publish date when at least 80% of posts have one, else by
 *   chapter number when at least 90% have one (undated / unnumbered posts stay
 *   next to their neighbours), else (for a newest-first page listing) reversed.
 */
export function orderOldestFirst(posts: PostRef[], order: ListingOrder): PostRef[] {
  if (posts.length < 2) return [...posts]
  const dates = posts.map(dateOf)
  const nums = posts.map(chapterNumberOf)

  if (order === "collection") {
    return looksNewestFirst(dates, nums) ? [...posts].reverse() : [...posts]
  }

  const items = posts.map((p, i) => ({ p, i, d: dates[i], n: nums[i] }))
  const base = order === "newest-first" ? [...items].reverse() : items
  const pos = new Map(base.map((x, k) => [x, k]))
  const byBase = (a: (typeof items)[0], b: (typeof items)[0]) => (pos.get(a) as number) - (pos.get(b) as number)
  const dated = dates.filter((d) => d !== null).length
  if (dated >= 2 && dated >= 0.8 * posts.length) {
    return sortKeepingNeighbours(base, (x) => x.d, (a, b) => (a.n ?? 0) - (b.n ?? 0) || byBase(a, b)).map((x) => x.p)
  }
  const numbered = nums.filter((n) => n !== null).length
  if (numbered >= 2 && numbered >= 0.9 * posts.length) {
    return sortKeepingNeighbours(base, (x) => x.n, byBase).map((x) => x.p)
  }
  return base.map((x) => x.p)
}

/**
 * Drop the book's name from a chapter title: "Nightmare Realm Summoner -
 * Chapter 476" → "Chapter 476". Leaves the title alone if nothing would remain.
 */
export function cleanChapterTitle(title: string, bookTitle?: string): string {
  const t = title.replace(/\s+/g, " ").trim()
  if (!bookTitle) return t
  const prefix = bookTitle.replace(/\s+/g, " ").trim()
  if (!prefix || !t.toLowerCase().startsWith(prefix.toLowerCase())) return t
  const tail = t.slice(prefix.length)
  // Only strip at a word boundary: "Summoners Ch 1" must not lose its "s".
  if (!/^[\s\-–—:|,]/.test(tail)) return t
  const rest = tail.replace(/^\s*[-–—:|,]\s*/, "").trim()
  return rest && rest !== t ? rest : t
}
