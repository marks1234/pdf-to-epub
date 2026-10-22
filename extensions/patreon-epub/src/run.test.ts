import { describe, it, expect, vi } from "vitest"

import { HttpError, NotJsonError, type Http } from "./http"
import type { PostRef } from "./patreon-api"
import type { FailureKind, PostResult } from "./posts"
import { fetchAll, orderResults, probeSession, type RunDeps } from "./run"

const refs = (n: number): PostRef[] => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), title: `Chapter ${i + 1}` }))
const ok = (id: string, publishedAt?: string): PostResult => ({ ok: true, id, title: `Chapter ${id}`, html: "<p>x</p>", publishedAt })
const bad = (id: string, kind: FailureKind): PostResult => ({ ok: false, id, title: `Chapter ${id}`, reason: kind, kind })

const nullHttp: Http = {
  getJson: async () => ({}),
  getText: async () => "",
  getBytes: async () => new ArrayBuffer(0),
}

/** `script(id, attempt)` decides each fetch's outcome. */
function deps(script: (id: string, attempt: number) => PostResult, extra: Partial<RunDeps> = {}) {
  const attempts = new Map<string, number>()
  const fetchPost = vi.fn(async (ref: PostRef) => {
    const n = (attempts.get(ref.id) ?? 0) + 1
    attempts.set(ref.id, n)
    return script(ref.id, n)
  })
  const sleeps: number[] = []
  const d: RunDeps = {
    http: nullHttp,
    cache: new Map(),
    signal: new AbortController().signal,
    fetchPost,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    waitOnline: () => new Promise(() => {}),
    probe: vi.fn(async () => true),
    ...extra,
  }
  return { d, fetchPost, sleeps, attempts }
}

describe("fetchAll", () => {
  it("pauses after 3 transient failures and retries them instead of skipping", async () => {
    let calls = 0
    const { d, sleeps } = deps((id) => (++calls <= 3 ? bad(id, "transient") : ok(id)))
    const onPause = vi.fn()
    const out = await fetchAll(refs(4), { ...d, onPause })
    expect(out.halted).toBeUndefined()
    expect(out.results.map((r) => r.ok)).toEqual([true, true, true, true])
    expect(out.results.map((r) => r.id)).toEqual(["1", "2", "3", "4"])
    expect(sleeps).toEqual([30_000])
    expect(onPause).toHaveBeenCalledWith(expect.stringMatching(/retrying in 30s/))
  })

  it("halts after the pause ladder on endless 503s", async () => {
    const { d, sleeps } = deps((id) => bad(id, "transient"))
    const out = await fetchAll(refs(5), d)
    expect(out.halted).toMatchObject({ kind: "transient", index: 0 })
    expect(sleeps).toEqual([30_000, 60_000, 120_000])
  })

  it("halts with auth after 2 NotJson results and a failing probe", async () => {
    const probe = vi.fn(async () => false)
    const { d } = deps((id) => (id === "1" ? ok(id) : bad(id, "auth")), { probe })
    const out = await fetchAll(refs(5), d)
    expect(out.halted).toMatchObject({ kind: "auth", index: 3 })
    expect(probe).toHaveBeenCalledWith("1")
    expect(out.results).toHaveLength(3)
  })

  it("continues past 3 locked posts when the probe passes", async () => {
    const probe = vi.fn(async () => true)
    const { d } = deps((id) => (id === "1" || id === "6" ? ok(id) : bad(id, "locked")), { probe })
    const out = await fetchAll(refs(6), d)
    expect(out.halted).toBeUndefined()
    expect(out.results).toHaveLength(6)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it("locked and missing posts don't count toward the transient streak", async () => {
    const { d, sleeps } = deps((id) => (["2", "4"].includes(id) ? bad(id, "transient") : bad(id, id === "3" ? "missing" : "locked")))
    const out = await fetchAll(refs(5), d)
    expect(sleeps).toEqual([])
    expect(out.halted).toBeUndefined()
  })

  it("a warm cache refetches only what's missing", async () => {
    const cache = new Map<string, PostResult>([["1", ok("1")], ["3", ok("3")]])
    const { d, fetchPost } = deps((id) => ok(id), { cache })
    const out = await fetchAll(refs(4), d)
    expect(fetchPost.mock.calls.map((c) => c[0].id)).toEqual(["2", "4"])
    expect(out.results.map((r) => r.id)).toEqual(["1", "2", "3", "4"])
    expect([...cache.keys()].sort()).toEqual(["1", "2", "3", "4"])
  })

  it("caches successes and missing posts, not transient failures", async () => {
    const cache = new Map<string, PostResult>()
    const { d } = deps((id) => (id === "2" ? bad(id, "missing") : id === "3" ? bad(id, "locked") : ok(id)), { cache })
    await fetchAll(refs(3), d)
    expect([...cache.keys()].sort()).toEqual(["1", "2"])
  })

  it("stops on cancel", async () => {
    const abort = new AbortController()
    const { d, fetchPost } = deps((id) => {
      if (id === "2") abort.abort()
      return ok(id)
    }, { signal: abort.signal })
    await expect(fetchAll(refs(5), d)).rejects.toMatchObject({ name: "AbortError" })
    expect(fetchPost).toHaveBeenCalledTimes(2)
  })
})

describe("probeSession", () => {
  const http = (r: unknown): Http => ({
    ...nullHttp,
    getJson: async () => {
      if (r instanceof Error) throw r
      return r
    },
  })
  it("fails on a login page or 401, passes on a readable post", async () => {
    expect(await probeSession(http(new NotJsonError(200, "text/html", "u", false)), "1")).toBe(false)
    expect(await probeSession(http(new HttpError(401, "https://www.patreon.com/api")), undefined)).toBe(false)
    expect(await probeSession(http({ data: { id: "1", attributes: { content: "<p>x</p>" } } }), "1")).toBe(true)
  })
})

describe("orderResults", () => {
  it("a failure doesn't change the order of the successes", () => {
    const r = [ok("3", "2026-01-03"), bad("x", "transient"), ok("2", "2026-01-02"), ok("1", "2026-01-01")]
    expect(orderResults(r, "newest-first").map((x) => x.id)).toEqual(["1", "2", "3", "x"])
  })
})
