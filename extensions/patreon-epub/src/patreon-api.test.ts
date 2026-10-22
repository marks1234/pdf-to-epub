import { describe, it, expect, vi } from "vitest"

import { HttpError } from "./http"
import {
  cleanChapterTitle,
  listCollection,
  orderOldestFirst,
  parseCollection,
  parsePost,
  parsePostListPage,
  plausibleListing,
  postsListUrl,
  titleSortKey,
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
  const p1 = postsListUrl("9", true, 100)
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
    const loop = postsListUrl("9", true, 100)
    const d = deps({
      fetchJson: async (url: string) =>
        url === loop ? { data: [post("1", "Chapter 1", "2026-01-01")], links: { next: "https://www.patreon.com/api/posts?again" } }
        : url.includes("again") ? { data: [post("1", "Chapter 1", "2026-01-01")], links: { next: "https://www.patreon.com/api/posts?again" } }
        : { data: { id: "9", attributes: {} } },
      visibleIds: ["1"],
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

describe("listCollection (bounded, complete)", () => {
  const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(from + i))
  const collection = (postIds: string[], titled = true, numPosts?: number) => ({
    data: { id: "9", attributes: { title: "Book", post_ids: postIds, ...(numPosts ? { num_posts: numPosts } : {}) } },
    included: titled ? postIds.map((id) => post(id, `Chapter ${id}`, "2026-01-01")) : [],
  })
  const harvest = vi.fn(async () => [] as string[])

  it("a complete collection never calls /api/posts", async () => {
    const calls: string[] = []
    const listing = await listCollection("9", {
      fetchJson: async (url) => {
        calls.push(url)
        return collection(ids(3), true, 3)
      },
      harvestPage: harvest,
      visibleIds: ["3"],
    })
    expect(listing.source).toBe("collection-api")
    expect(calls).toHaveLength(1)
    expect(listing.incomplete).toBeUndefined()
  })

  it("dedupes post_ids", () => {
    expect(parseCollection(collection(["1", "2", "1"])).postIds).toEqual(["1", "2"])
  })

  it("an endless feed that ignores the filter stops early, with no unsorted crawl", async () => {
    const calls: string[] = []
    let n = 0
    await expect(
      listCollection("9", {
        fetchJson: async (url) => {
          calls.push(url)
          if (url.includes("/api/collection/")) throw new Error("HTTP 500")
          n += 20
          return { data: ids(20, n).map((id) => post(id, "x", "2026-01-01")), links: { next: `https://www.patreon.com/api/posts?c=${n}` } }
        },
        harvestPage: harvest,
        visibleIds: [],
        expectedCount: 178,
      }),
    ).rejects.toThrow(/Couldn't list/)
    expect(calls.length).toBeLessThanOrEqual(22)
    expect(calls[0]).toContain("/api/collection/")
    expect(calls.some((u) => u.includes("filter%5Bcollection_id%5D") && !u.includes("sort="))).toBe(false)
  })

  it("a 178-post sorted listing succeeds when only the newest 20 are visible", async () => {
    const all = ids(178)
    const listing = await listCollection("9", {
      fetchJson: async (url) => {
        if (url.includes("/api/collection/")) return { data: { id: "9", attributes: {} } }
        const page = Number(new URL(url).searchParams.get("page[cursor]") ?? 0)
        const slice = all.slice(page * 100, page * 100 + 100)
        return { data: slice.map((id) => post(id, `C ${id}`, "2026-01-01")), links: page === 0 ? { next: { href: "/api/posts?page%5Bcursor%5D=1" } } : {} }
      },
      harvestPage: harvest,
      visibleIds: all.slice(-20).reverse(),
      expectedCount: 178,
    })
    expect(listing.source).toBe("posts-api")
    expect(listing.posts).toHaveLength(178)
  })

  it("a 400 on page[count] retries still sorted; a 400 on sort retries unsorted", async () => {
    const calls: string[] = []
    const listing = await listCollection("9", {
      fetchJson: async (url) => {
        calls.push(url)
        if (url.includes("/api/collection/")) return { data: { id: "9", attributes: {} } }
        if (url.includes("page%5Bcount%5D") || url.includes("sort=")) throw new HttpError(400, url)
        return { data: [post("3", "C3", "2026-01-03")] }
      },
      harvestPage: harvest,
      visibleIds: ["3"],
    })
    expect(listing.source).toBe("posts-api-unsorted")
    expect(calls[1]).toContain("page%5Bcount%5D=100")
    expect(calls[2]).toContain("sort=")
    expect(calls[2]).not.toContain("page%5Bcount%5D")
  })

  it("short posts listing + full collection: the longer one wins", async () => {
    const listing = await listCollection("9", {
      fetchJson: async (url) => {
        if (url.includes("/api/collection/")) return collection(ids(10), false)
        return { data: ids(4).map((id) => post(id, `C${id}`, "2026-01-01")) }
      },
      harvestPage: harvest,
      visibleIds: ["1"],
      expectedCount: 10,
    })
    expect(listing.source).toBe("collection-api")
    expect(listing.posts).toHaveLength(10)
  })

  it("all strategies short: incomplete is set", async () => {
    const listing = await listCollection("9", {
      fetchJson: async (url) => {
        if (url.includes("/api/collection/")) throw new Error("HTTP 500")
        return { data: ids(4).map((id) => post(id, `C${id}`, "2026-01-01")) }
      },
      harvestPage: async () => ["2", "1"],
      visibleIds: ["1"],
      expectedCount: 10,
    })
    expect(listing.incomplete).toEqual({ found: 4, expected: 10 })
    expect(listing.notes?.length).toBeGreaterThan(0)
  })

  it("no validators at all: falls through to the harvest", async () => {
    const calls: string[] = []
    const listing = await listCollection("9", {
      fetchJson: async (url) => {
        calls.push(url)
        if (url.includes("/api/collection/")) return { data: { id: "9", attributes: {} } }
        return { data: [post("70", "x", "2026-01-01")] }
      },
      harvestPage: async () => ["5", "4"],
      visibleIds: [],
    })
    expect(listing.source).toBe("page")
    expect(calls).toHaveLength(1)
  })
})

describe("pagination drift", () => {
  const cur = postsListUrl("9", true)
  it("follows a non-www patreon link and {href}; rejects other hosts", () => {
    expect(parsePostListPage({ data: [], links: { next: "https://patreon.com/api/posts?c=2" } }, cur).next).toBe(
      "https://www.patreon.com/api/posts?c=2",
    )
    expect(parsePostListPage({ data: [], links: { next: { href: "/api/posts?c=3" } } }, cur).next).toBe(
      "https://www.patreon.com/api/posts?c=3",
    )
    const bad = parsePostListPage({ data: [], links: { next: "https://evil.example/x" } }, cur)
    expect(bad).toMatchObject({ next: null, nextRejected: true })
  })
  it("reads cursors from meta.next_cursor and links.next.cursor", () => {
    const a = parsePostListPage({ data: [], meta: { next_cursor: "k1" } }, cur).next as string
    expect(new URL(a).searchParams.get("page[cursor]")).toBe("k1")
    const b = parsePostListPage({ data: [], links: { next: { cursor: "k2" } } }, cur).next as string
    expect(new URL(b).searchParams.get("page[cursor]")).toBe("k2")
  })
  it("a rejected next link marks the listing truncated (and incomplete)", async () => {
    const listing = await listCollection("9", {
      fetchJson: async (url) => {
        if (url.includes("/api/collection/")) throw new Error("HTTP 500")
        return { data: [post("1", "C1", "2026-01-01")], links: { next: "https://evil.example/x" } }
      },
      harvestPage: async () => [],
      visibleIds: ["1"],
    })
    expect(listing.truncated).toBe(true)
    expect(listing.incomplete).toBeDefined()
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

describe("ordering robustness", () => {
  const p = (id: string, date: string | undefined, title = `Chapter ${id}`): PostRef => ({ id, title, publishedAt: date })
  const ids = (ps: PostRef[]) => ps.map((x) => x.id)
  const asc = [p("1", "2025-01-01"), p("2", "2025-02-01"), p("3", "2025-03-01"), p("4", "2025-04-01")]

  it("a 2026 index post in front of ascending 2025 chapters doesn't reverse the book", () => {
    const list = [p("idx", "2026-05-01", "Index"), ...asc]
    expect(ids(orderOldestFirst(list, "collection"))).toEqual(["idx", "1", "2", "3", "4"])
  })
  it("the mirror case is reversed", () => {
    const list = [...[...asc].reverse(), p("idx", "2026-05-01", "Index")]
    expect(ids(orderOldestFirst(list, "collection"))).toEqual(["idx", "1", "2", "3", "4"])
  })
  it("null dates at both ends with a descending middle are reversed", () => {
    const list = [p("a", undefined, "Note"), ...[...asc].reverse(), p("z", undefined, "Note 2")]
    expect(ids(orderOldestFirst(list, "collection"))).toEqual(["z", "1", "2", "3", "4", "a"])
  })
  it("an undated interlude stays next to its neighbour in a newest-first list", () => {
    const list = [p("4", "2025-04-01"), p("3", "2025-03-01"), p("i", undefined, "Interlude"), p("2", "2025-02-01"), p("1", "2025-01-01")]
    expect(ids(orderOldestFirst(list, "newest-first"))).toEqual(["1", "2", "i", "3", "4"])
  })
  it("title sort keys", () => {
    const k = (t: string) => titleSortKey(t) as number
    expect(k("Vol. 2 Ch 3")).toBeLessThan(k("Vol. 3 Ch 1"))
    expect(k("Chapter 12")).toBeLessThan(k("12.5"))
    expect(k("12.5")).toBeLessThan(k("13"))
    expect(k("Ch 40 - Mr. Grey")).toBe(40)
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
