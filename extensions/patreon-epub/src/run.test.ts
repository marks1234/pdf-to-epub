import { describe, it, expect, vi } from "vitest"

import { createHttp, HttpError, NotJsonError, type Http } from "./http"
import type { PostRef } from "./patreon-api"
import type { FailureKind, PostResult } from "./posts"
import { createPool, fetchAll, orderResults, probeSession, type RunDeps } from "./run"

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

describe("fetchAll with the adaptive pool", () => {
  /** A fetch whose completion the test controls. */
  function controlled() {
    const pending = new Map<string, (r: PostResult) => void>()
    let inFlight = 0
    let maxInFlight = 0
    const started: string[] = []
    const fetchPost = vi.fn(
      (ref: PostRef) =>
        new Promise<PostResult>((resolve) => {
          started.push(ref.id)
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          pending.set(ref.id, (r) => {
            inFlight--
            pending.delete(ref.id)
            resolve(r)
          })
        }),
    )
    const tick = () => new Promise((r) => setTimeout(r, 0))
    return { pending, fetchPost, started, tick, max: () => maxInFlight }
  }

  it("keeps collection order under out-of-order completion, counts completions, never exceeds 3", async () => {
    const c = controlled()
    const progress: number[] = []
    const run = fetchAll(refs(6), {
      ...deps(() => ok("x")).d,
      fetchPost: c.fetchPost,
      pool: createPool(3),
      onProgress: (done) => progress.push(done),
    })
    await c.tick()
    expect(c.started).toEqual(["1", "2", "3"])
    // Finish 3, then 1, then 2 — out of order.
    for (const id of ["3", "1", "2", "5", "4", "6"]) {
      while (!c.pending.has(id)) await c.tick()
      c.pending.get(id)!(ok(id))
      await c.tick()
    }
    const out = await run
    expect(out.results.map((r) => r.id)).toEqual(["1", "2", "3", "4", "5", "6"])
    expect(progress).toEqual([1, 2, 3, 4, 5, 6])
    expect(c.max()).toBe(3)
  })

  it("drops to one in flight on a rate limit and creeps back after 20 successes", async () => {
    const c = controlled()
    const pool = createPool(3)
    const run = fetchAll(refs(30), { ...deps(() => ok("x")).d, fetchPost: c.fetchPost, pool })
    await c.tick()
    pool.rateLimited() // what the HTTP layer's onWait does on a 429
    expect(pool.limit).toBe(1)
    let maxAfter = 0
    for (let n = 0; n < 30; n++) {
      while (c.pending.size === 0) await c.tick()
      const [id] = [...c.pending.keys()].sort((a, b) => Number(a) - Number(b))
      c.pending.get(id)!(ok(id))
      await c.tick()
      // Before 20 successes since the limit dropped, at most one new request starts at a time.
      if (n >= 3 && n < 19) maxAfter = Math.max(maxAfter, c.pending.size)
    }
    await run
    expect(maxAfter).toBe(1)
    expect(pool.limit).toBe(2)
  })

  it("a transient result drops the pool to one", async () => {
    const pool = createPool(3)
    const { d } = deps((id) => (id === "1" ? bad(id, "transient") : ok(id)), { pool })
    await fetchAll(refs(4), d)
    expect(pool.limit).toBe(1)
  })

  it("cancel stops new starts", async () => {
    const c = controlled()
    const abort = new AbortController()
    const run = fetchAll(refs(10), { ...deps(() => ok("x")).d, fetchPost: c.fetchPost, pool: createPool(3), signal: abort.signal })
    await c.tick()
    abort.abort()
    for (const resolve of [...c.pending.values()]) resolve(ok("x"))
    await expect(run).rejects.toMatchObject({ name: "AbortError" })
    expect(c.started).toHaveLength(3)
  })
})

describe("http concurrency", () => {
  it("allows up to N requests in flight and spaces their starts", async () => {
    let inFlight = 0
    let max = 0
    const waits: number[] = []
    const http = createHttp({
      concurrency: 3,
      minDelayMs: 250,
      maxDelayMs: 250,
      random: () => 0,
      now: () => 1000,
      sleep: async (ms) => {
        waits.push(ms)
      },
      fetchImpl: (async () => {
        inFlight++
        max = Math.max(max, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return new Response("{}", { headers: { "content-type": "application/json" } })
      }) as unknown as typeof fetch,
    })
    await Promise.all(Array.from({ length: 6 }, (_, i) => http.getJson(`https://www.patreon.com/api/${i}`)))
    expect(max).toBe(3)
    expect(waits.filter((w) => w === 250)).toHaveLength(5)
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
