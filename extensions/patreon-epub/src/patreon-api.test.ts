import { describe, it, expect, vi } from "vitest"

import {
  cleanChapterTitle,
  listCollection,
  orderOldestFirst,
  parseCollection,
  parsePost,
  parsePostListPage,
  plausibleListing,
  postsListUrl,
  type ListingDeps,
  type PostRef,
} from "./patreon-api"

const post = (id: string, title: string, date: string) => ({
  id,
  type: "post",
  attributes: { title, published_at: date, url: `https://www.patreon.com/posts/${id}` },
})

describe("parsePostListPage", () => {
  it("reads posts and an absolute links.next", () => {
    const page = parsePostListPage(
      {
        data: [post("1", "Chapter 1", "2026-01-01T00:00:00Z"), { id: "x", type: "user" }],
        links: { next: "https://www.patreon.com/api/posts?page%5Bcursor%5D=abc" },
      },
      "https://www.patreon.com/api/posts",
    )
    expect(page.posts).toEqual([
      { id: "1", title: "Chapter 1", publishedAt: "2026-01-01T00:00:00Z", url: "https://www.patreon.com/posts/1" },
    ])
    expect(page.next).toBe("https://www.patreon.com/api/posts?page%5Bcursor%5D=abc")
  })

  it("resolves a relative next link and builds one from a cursor", () => {
    expect(parsePostListPage({ data: [], links: { next: "/api/posts?x=1" } }, postsListUrl("9", true)).next).toBe(
      "https://www.patreon.com/api/posts?x=1",
    )
    const next = parsePostListPage({ data: [], meta: { pagination: { cursors: { next: "c2" } } } }, postsListUrl("9", true)).next
    expect(new URL(next as string).searchParams.get("page[cursor]")).toBe("c2")
    expect(new URL(next as string).searchParams.get("filter[collection_id]")).toBe("9")
  })

  it("refuses to follow a next link to another origin", () => {
    expect(parsePostListPage({ data: [], links: { next: "https://evil.example/api" } }, postsListUrl("9", true)).next).toBeNull()
  })

  it("rejects a response without a data array", () => {
    expect(() => parsePostListPage({ errors: [{}] }, postsListUrl("9", true))).toThrow()
  })
})

describe("parseCollection / parsePost", () => {
  it("reads title, ordered ids, included posts, cover and creator", () => {
    const info = parseCollection({
      data: {
        id: "9",
        type: "collection",
        attributes: { title: "Book", num_posts: 2, post_ids: [2, 1], thumbnail: { large: "https://c10.example/t.jpg" } },
      },
      included: [post("1", "Chapter 1", "2026-01-01T00:00:00Z"), { id: "c", type: "campaign", attributes: { name: "Writer" } }],
    })
    expect(info.title).toBe("Book")
    expect(info.postIds).toEqual(["2", "1"])
    expect(info.posts.map((p) => [p.id, p.title])).toEqual([["2", undefined], ["1", "Chapter 1"]])
    expect(info.coverUrl).toBe("https://c10.example/t.jpg")
    expect(info.creator).toBe("Writer")
  })

  it("falls back to relationships for order", () => {
    const info = parseCollection({ data: { id: "9", relationships: { posts: { data: [{ id: "5", type: "post" }] } } } })
    expect(info.postIds).toEqual(["5"])
  })

  it("parses post content, and null content for a locked post", () => {
    expect(parsePost({ data: { id: "1", attributes: { title: "T", content: "<p>x</p>" } } }).html).toBe("<p>x</p>")
    const locked = parsePost({ data: { id: "1", attributes: { title: "T", content: "", current_user_can_view: false } } })
    expect(locked.html).toBeNull()
    expect(locked.canView).toBe(false)
  })
})

describe("listCollection", () => {
  const pages: Record<string, unknown> = {}
  const p1 = postsListUrl("9", true)
  const p2 = "https://www.patreon.com/api/posts?cursor=2"
  pages[p1] = { data: [post("1", "Chapter 1", "2026-01-01"), post("2", "Chapter 2", "2026-01-02")], links: { next: p2 } }
  pages[p2] = { data: [post("3", "Chapter 3", "2026-01-03")], links: {} }

  const deps = (overrides: Partial<ListingDeps> = {}): ListingDeps => ({
    fetchJson: vi.fn(async (url: string) => {
      if (url.includes("/api/collection/")) return { data: { id: "9", attributes: { title: "Book" } } }
      if (url in pages) return pages[url]
      throw new Error(`HTTP 400 for ${url}`)
    }),
    harvestPage: vi.fn(async () => ["3", "2", "1"]),
    visibleIds: ["3"],
    ...overrides,
  })

  it("follows pagination on the sorted posts API", async () => {
    const d = deps()
    const listing = await listCollection("9", d)
    expect(listing.source).toBe("posts-api")
    expect(listing.order).toBe("collection")
    expect(listing.posts.map((p) => p.id)).toEqual(["1", "2", "3"])
    expect(listing.collection?.title).toBe("Book")
    expect(d.harvestPage).not.toHaveBeenCalled()
  })

  it("stops when a page repeats (cursor not advancing)", async () => {
    const loop = postsListUrl("9", true)
    const d = deps({
      fetchJson: async (url: string) =>
        url === loop ? { data: [post("1", "Chapter 1", "2026-01-01")], links: { next: "https://www.patreon.com/api/posts?again" } }
        : url.includes("again") ? { data: [post("1", "Chapter 1", "2026-01-01")], links: { next: "https://www.patreon.com/api/posts?again" } }
        : { data: { id: "9", attributes: {} } },
      visibleIds: [],
    })
    const listing = await listCollection("9", d)
    expect(listing.posts.map((p) => p.id)).toEqual(["1"])
  })

  it("falls back to the unsorted listing when sort is rejected", async () => {
    const unsorted = postsListUrl("9", false)
    const d = deps({
      fetchJson: async (url: string) => {
        if (url === unsorted) return { data: [post("3", "Chapter 3", "2026-01-03"), post("1", "Chapter 1", "2026-01-01")] }
        if (url.includes("/api/collection/")) return { data: { id: "9", attributes: {} } }
        throw new Error("HTTP 400")
      },
    })
    const listing = await listCollection("9", d)
    expect(listing.source).toBe("posts-api-unsorted")
    expect(listing.order).toBe("unordered")
  })

  it("rejects a listing that ignores the filter, then uses the collection endpoint", async () => {
    const d = deps({
      fetchJson: async (url: string) => {
        if (url.includes("/api/collection/"))
          return { data: { id: "9", attributes: { title: "Book", post_ids: ["1", "2", "3"] } } }
        // A feed of unrelated posts: doesn't contain the visible id "3".
        return { data: [post("70", "Other", "2026-01-01"), post("71", "Other 2", "2026-01-02")] }
      },
    })
    const listing = await listCollection("9", d)
    expect(listing.source).toBe("collection-api")
    expect(listing.posts.map((p) => p.id)).toEqual(["1", "2", "3"])
  })

  it("harvests the page as a last resort", async () => {
    const d = deps({
      fetchJson: async () => {
        throw new Error("HTTP 500")
      },
    })
    const listing = await listCollection("9", d)
    expect(listing.source).toBe("page")
    expect(listing.order).toBe("newest-first")
    expect(listing.posts.map((p) => p.id)).toEqual(["3", "2", "1"])
  })

  it("throws when every strategy fails", async () => {
    const d = deps({
      fetchJson: async () => {
        throw new Error("HTTP 500")
      },
      harvestPage: async () => [],
    })
    await expect(listCollection("9", d)).rejects.toThrow(/Couldn't list/)
  })
})

describe("plausibleListing", () => {
  const refs = (n: number): PostRef[] => Array.from({ length: n }, (_, i) => ({ id: String(i) }))
  it("needs posts, overlap with the page, and a sane size", () => {
    expect(plausibleListing([], [], undefined)).toBe(false)
    expect(plausibleListing(refs(3), ["2"], 3)).toBe(true)
    expect(plausibleListing(refs(3), ["99"], 3)).toBe(false)
    expect(plausibleListing(refs(500), [], 178)).toBe(false)
    expect(plausibleListing(refs(180), [], 178)).toBe(true)
  })
})

describe("orderOldestFirst", () => {
  const a: PostRef = { id: "a", title: "Chapter 10", publishedAt: "2026-01-01T00:00:00Z" }
  const b: PostRef = { id: "b", title: "Chapter 11", publishedAt: "2026-01-02T00:00:00Z" }
  const c: PostRef = { id: "c", title: "Chapter 12", publishedAt: "2026-01-03T00:00:00Z" }
  const ids = (ps: PostRef[]) => ps.map((p) => p.id)

  it("keeps an ascending collection order", () => {
    expect(ids(orderOldestFirst([a, b, c], "collection"))).toEqual(["a", "b", "c"])
  })
  it("reverses a collection order that runs newest first", () => {
    expect(ids(orderOldestFirst([c, b, a], "collection"))).toEqual(["a", "b", "c"])
  })
  it("keeps a creator's manual collection order when dates don't say otherwise", () => {
    expect(ids(orderOldestFirst([a, c, b], "collection"))).toEqual(["a", "c", "b"])
  })
  it("sorts an unordered listing by date", () => {
    expect(ids(orderOldestFirst([b, c, a], "unordered"))).toEqual(["a", "b", "c"])
  })
  it("sorts by chapter number when dates are missing", () => {
    const strip = (p: PostRef) => ({ ...p, publishedAt: undefined })
    expect(ids(orderOldestFirst([c, a, b].map(strip), "unordered"))).toEqual(["a", "b", "c"])
  })
  it("reverses a bare newest-first page listing", () => {
    expect(ids(orderOldestFirst([{ id: "3" }, { id: "2" }, { id: "1" }], "newest-first"))).toEqual(["1", "2", "3"])
  })
})

describe("cleanChapterTitle", () => {
  it("drops the book name prefix", () => {
    expect(cleanChapterTitle("Nightmare Book - Chapter 476", "Nightmare Book")).toBe("Chapter 476")
    expect(cleanChapterTitle("Nightmare Book: Chapter 1", "nightmare book")).toBe("Chapter 1")
  })
  it("leaves other titles alone", () => {
    expect(cleanChapterTitle("Nightmare Books Ch 1", "Nightmare Book")).toBe("Nightmare Books Ch 1")
    expect(cleanChapterTitle("Nightmare Book", "Nightmare Book")).toBe("Nightmare Book")
    expect(cleanChapterTitle("Side story", "Nightmare Book")).toBe("Side story")
  })
})
