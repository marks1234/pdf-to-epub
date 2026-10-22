import { describe, it, expect, vi } from "vitest"

import { createHttp, HttpError, NotJsonError, retryAfterMs, type HttpOptions } from "./http"

const JSON_CT = { "content-type": "application/json" }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_CT, ...headers } })
const API = "https://www.patreon.com/api/x"

type Reply = Response | Error | ((init?: RequestInit) => Promise<Response>)

function setup(responses: Reply[], opts: HttpOptions = {}) {
  const calls: string[] = []
  const waits: number[] = []
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(url))
    const next = responses.shift()
    if (!next) throw new Error("no more responses")
    if (next instanceof Error) throw next
    if (typeof next === "function") return next(init)
    return next
  }) as unknown as typeof fetch
  const http = createHttp({
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms)
    },
    random: () => 0,
    now: () => 1_000_000,
    ...opts,
  })
  return { http, calls, waits, fetchImpl }
}

/** A fetch that never answers but honours its abort signal. */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
  })

describe("createHttp", () => {
  it("retries 429 / 5xx / network errors, honoring Retry-After", async () => {
    const { http, calls, waits } = setup([
      json({}, 429, { "Retry-After": "3" }),
      json({}, 503),
      new TypeError("Failed to fetch"),
      json({ ok: 1 }),
    ])
    await expect(http.getJson(API)).resolves.toEqual({ ok: 1 })
    expect(calls).toHaveLength(4)
    expect(waits).toContain(3000)
  })

  it("gives up after 3 retries", async () => {
    const { http, calls } = setup([json({}, 500), json({}, 500), json({}, 500), json({}, 500), json({}, 200)])
    await expect(http.getJson(API)).rejects.toBeInstanceOf(HttpError)
    expect(calls).toHaveLength(4)
  })

  it("does not retry other 4xx, and retries 408", async () => {
    const { http, calls } = setup([json({}, 404)])
    await expect(http.getJson(API)).rejects.toMatchObject({ status: 404 })
    expect(calls).toHaveLength(1)
    const t = setup([json({}, 408), json({ ok: 1 })])
    await expect(t.http.getJson(API)).resolves.toEqual({ ok: 1 })
    expect(t.calls).toHaveLength(2)
  })

  it("puts the content type in HttpError", async () => {
    const { http } = setup([new Response("<html>", { status: 403, headers: { "content-type": "text/html; charset=utf-8" } })])
    await expect(http.getJson(API)).rejects.toMatchObject({ status: 403, contentType: "text/html; charset=utf-8", message: "HTTP 403 (text/html) for /api/x" })
  })

  it("parses Retry-After dates and caps it at five minutes", () => {
    expect(retryAfterMs("120")).toBe(120_000)
    expect(retryAfterMs("9999")).toBe(300_000)
    expect(retryAfterMs(new Date(1_000_000 + 5000).toUTCString(), 1_000_000)).toBe(5000)
    expect(retryAfterMs(null)).toBeNull()
  })

  it("times out a hanging request, retries, then rejects with a timeout (not an abort)", async () => {
    const { http, calls } = setup([hang, hang, hang, hang], { timeoutMs: 30 })
    const err = (await http.getJson(API).catch((e: unknown) => e)) as Error
    expect(calls).toHaveLength(4)
    expect(err.name).toBe("TimeoutError")
  })

  it("a user cancel during a hang is an AbortError", async () => {
    const abort = new AbortController()
    const { http } = setup([hang], { signal: abort.signal, timeoutMs: 10_000 })
    const p = http.getJson(API)
    setTimeout(() => abort.abort(), 10)
    await expect(p).rejects.toMatchObject({ name: "AbortError" })
  })

  it("retries a body that fails to read after a 200", async () => {
    const broken = new Response(
      new ReadableStream({
        start(c) {
          c.error(new TypeError("stream broke"))
        },
      }),
      { headers: JSON_CT },
    )
    const { http, calls } = setup([broken, json({ ok: 2 })])
    await expect(http.getJson(API)).resolves.toEqual({ ok: 2 })
    expect(calls).toHaveLength(2)
  })

  it("retries a truncated JSON body", async () => {
    const { http, calls } = setup([new Response('{"a":', { headers: JSON_CT }), json({ ok: 3 })])
    await expect(http.getJson(API)).resolves.toEqual({ ok: 3 })
    expect(calls).toHaveLength(2)
  })

  it("a 200 HTML page is NotJsonError after exactly one call", async () => {
    const { http, calls } = setup([new Response("<html>login</html>", { headers: { "content-type": "text/html" } })])
    await expect(http.getJson(API)).rejects.toBeInstanceOf(NotJsonError)
    expect(calls).toHaveLength(1)
  })

  it("a redirected response is NotJsonError", async () => {
    const r = json({ ok: 1 })
    Object.defineProperty(r, "redirected", { value: true })
    const { http } = setup([r])
    await expect(http.getJson(API)).rejects.toMatchObject({ name: "NotJsonError", redirected: true })
  })

  it("a 429 delays the next queued request until the cooldown ends", async () => {
    const onWait = vi.fn()
    const { http, waits } = setup([json({}, 429, { "Retry-After": "5" }), json({ a: 1 }), json({ b: 1 })], { onWait })
    const a = http.getJson(API)
    const b = http.getJson(`${API}/2`)
    await a
    const before = waits.length
    await b
    expect(onWait).toHaveBeenCalledWith(5000, "rate-limit")
    // Clock is frozen, so the second request still sees the 5 s cooldown.
    expect(waits.slice(before)).toContain(5000)
  })

  it("slows down after a 429 and decays after successes", async () => {
    const { http } = setup([json({}, 429, { "Retry-After": "1" }), json({}), json({}), json({})])
    expect(http.slow).toBe(1)
    await http.getJson(API)
    expect(http.slow).toBeCloseTo(1.8)
    await http.getJson(API)
    expect(http.slow).toBeCloseTo(1.62)
  })

  it("gives up after 8 consecutive 429s, independent of retries", async () => {
    const { http, calls } = setup(Array.from({ length: 10 }, () => json({}, 429, { "Retry-After": "1" })))
    await expect(http.getJson(API)).rejects.toMatchObject({ status: 429 })
    expect(calls).toHaveLength(8)
  })

  it("getBytes does not retry a TypeError and rejects non-images", async () => {
    const { http, calls } = setup([new TypeError("CORS"), json({})])
    await expect(http.getBytes("https://c10.patreonusercontent.com/x.jpg")).rejects.toBeInstanceOf(TypeError)
    expect(calls).toHaveLength(1)
    const t = setup([json({})])
    await expect(t.http.getBytes("https://c10.patreonusercontent.com/x.jpg")).rejects.toMatchObject({ name: "NotImageError" })
  })

  it("reports each attempt without bodies", async () => {
    const onAttempt = vi.fn()
    const { http } = setup([json({}, 500), json({ ok: 1 })], { onAttempt })
    await http.getJson(API)
    expect(onAttempt).toHaveBeenCalledTimes(2)
    expect(onAttempt.mock.calls[0][0]).toMatchObject({ status: 500, tryNo: 0 })
    expect(onAttempt.mock.calls[1][0]).toMatchObject({ status: 200, tryNo: 1 })
  })
})
