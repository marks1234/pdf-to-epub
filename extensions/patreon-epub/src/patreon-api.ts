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

export function postsListUrl(collectionId: string, withSort: boolean): string {
  const q = new URLSearchParams()
  q.set("filter[collection_id]", collectionId)
  if (withSort) q.set("sort", "collection_order")
  q.set("fields[post]", "title,published_at,url")
  q.set("json-api-version", "1.0")
  return `${ORIGIN}/api/posts?${q}`
}

export function collectionUrl(collectionId: string): string {
  const q = new URLSearchParams()
  q.set("include", "posts,campaign")
  q.set("fields[post]", "title,published_at,url")
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

function postRefFrom(resource: Json): PostRef | null {
  const id = idOf(resource.id)
  if (!id) return null
  const a = isObj(resource.attributes) ? resource.attributes : {}
  return {
    id,
    title: str(a.title),
    publishedAt: str(a.published_at),
    url: str(a.url),
  }
}

/**
 * Resolve a pagination link against the site origin. Only same-origin links are
 * followed — a response can never send the content script elsewhere.
 */
export function resolveSameOrigin(link: string, base = ORIGIN): string | null {
  try {
    const u = new URL(link, base)
    return u.origin === ORIGIN ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * One page of `/api/posts`. The next page comes from `links.next`; if that is
 * missing but a cursor is (`meta.pagination.cursors.next`), it is applied to
 * the current URL as `page[cursor]`.
 */
export function parsePostListPage(json: unknown, currentUrl: string): ListPage {
  if (!isObj(json) || !Array.isArray(json.data)) throw new ApiShapeError("Listing response has no data array.")
  const posts = json.data
    .filter(isObj)
    .filter((r) => r.type === undefined || r.type === "post")
    .map(postRefFrom)
    .filter((p): p is PostRef => p !== null)

  let next: string | null = null
  const links = isObj(json.links) ? json.links : {}
  if (typeof links.next === "string" && links.next) {
    next = resolveSameOrigin(links.next, currentUrl)
  } else {
    const meta = isObj(json.meta) ? json.meta : {}
    const pagination = isObj(meta.pagination) ? meta.pagination : {}
    const cursors = isObj(pagination.cursors) ? pagination.cursors : {}
    const cursor = str(cursors.next)
    if (cursor) {
      const u = new URL(currentUrl)
      u.searchParams.set("page[cursor]", cursor)
      next = resolveSameOrigin(u.toString())
    }
  }
  if (next === currentUrl) next = null
  return { posts, next }
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
  source: "posts-api" | "posts-api-unsorted" | "collection-api" | "page"
  /** Collection metadata, when the collection endpoint answered. */
  collection?: CollectionInfo
}

export interface ListingDeps {
  fetchJson(url: string): Promise<unknown>
  /** Post IDs harvested from the collection page itself, newest first. */
  harvestPage(): Promise<string[]>
  /** IDs already visible on the page; a listing must overlap them to be trusted. */
  visibleIds: string[]
  /** Expected post count (from the page title), if known. */
  expectedCount?: number
  /** Called as each strategy starts, for progress messages. */
  onStep?(message: string): void
  /** Safety cap on pages followed. */
  maxPages?: number
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
  if (expectedCount && posts.length > expectedCount + Math.max(5, expectedCount * 0.1)) return false
  return true
}

async function listViaPostsApi(collectionId: string, withSort: boolean, deps: ListingDeps): Promise<PostRef[]> {
  const posts: PostRef[] = []
  const seen = new Set<string>()
  let url: string | null = postsListUrl(collectionId, withSort)
  const maxPages = deps.maxPages ?? 200
  for (let page = 0; url && page < maxPages; page++) {
    const parsed = parsePostListPage(await deps.fetchJson(url), url)
    let fresh = 0
    for (const p of parsed.posts) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      posts.push(p)
      fresh++
    }
    // A page with nothing new means the cursor isn't advancing — stop.
    if (fresh === 0) break
    url = parsed.next
  }
  return posts
}

/**
 * List the collection's posts, trying in order: the posts API filtered by
 * collection and sorted by collection order; the same without the sort; the
 * collection endpoint; and finally harvesting links from the page itself.
 * Collection metadata is fetched alongside when possible (title, cover).
 */
export async function listCollection(collectionId: string, deps: ListingDeps): Promise<Listing> {
  const errors: string[] = []
  let collection: CollectionInfo | undefined

  const tryCollection = async (): Promise<CollectionInfo | undefined> => {
    try {
      return parseCollection(await deps.fetchJson(collectionUrl(collectionId)))
    } catch (e) {
      errors.push(`collection: ${errText(e)}`)
      return undefined
    }
  }

  for (const withSort of [true, false]) {
    deps.onStep?.(withSort ? "Listing chapters…" : "Listing chapters (retrying without sort)…")
    try {
      const posts = await listViaPostsApi(collectionId, withSort, deps)
      if (plausibleListing(posts, deps.visibleIds, deps.expectedCount)) {
        collection = await tryCollection()
        return {
          posts,
          order: withSort ? "collection" : "unordered",
          source: withSort ? "posts-api" : "posts-api-unsorted",
          collection,
        }
      }
      errors.push(`posts api${withSort ? "" : " (unsorted)"}: implausible listing (${posts.length} posts)`)
    } catch (e) {
      errors.push(`posts api${withSort ? "" : " (unsorted)"}: ${errText(e)}`)
    }
  }

  deps.onStep?.("Listing chapters via the collection endpoint…")
  collection = await tryCollection()
  if (collection && plausibleListing(collection.posts, deps.visibleIds, deps.expectedCount)) {
    return { posts: collection.posts, order: "collection", source: "collection-api", collection }
  }

  deps.onStep?.("Reading chapter links from the page (clicking “Load more”)…")
  const ids = await deps.harvestPage()
  if (ids.length > 0) {
    return { posts: ids.map((id) => ({ id })), order: "newest-first", source: "page", collection }
  }
  throw new Error(`Couldn't list this collection's posts. ${errors.join("; ")}`)
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

function chapterNumberOf(p: PostRef): number | null {
  return p.title ? extractNumber(p.title).num : null
}

/**
 * Normalize a listing to reading order (oldest first).
 *
 * - `collection` order is the creator's own order and is kept — unless its
 *   dates show it runs newest-first, in which case it is reversed.
 * - Otherwise: by publish date when every post has one, else by the chapter
 *   number in the title when every post has one, else (for a newest-first
 *   page listing) reversed.
 */
export function orderOldestFirst(posts: PostRef[], order: ListingOrder): PostRef[] {
  if (posts.length < 2) return [...posts]
  const dates = posts.map(dateOf)
  const allDated = dates.every((d) => d !== null)

  if (order === "collection") {
    const first = dates[0]
    const last = dates[dates.length - 1]
    return first !== null && last !== null && first > last ? [...posts].reverse() : [...posts]
  }

  const indexed = posts.map((p, i) => ({ p, i, d: dates[i], n: chapterNumberOf(p) }))
  if (allDated) {
    return indexed
      .sort((a, b) => (a.d as number) - (b.d as number) || (a.n ?? 0) - (b.n ?? 0) || a.i - b.i)
      .map((x) => x.p)
  }
  if (indexed.every((x) => x.n !== null)) {
    return indexed.sort((a, b) => (a.n as number) - (b.n as number) || a.i - b.i).map((x) => x.p)
  }
  return order === "newest-first" ? [...posts].reverse() : [...posts]
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
