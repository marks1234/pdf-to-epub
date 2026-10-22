import { describe, it, expect, vi } from "vitest"

import { createHttp, HttpError, retryAfterMs } from "./http"
import { fetchPostContent } from "./posts"

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

function setup(responses: (Response | Error)[]) {
  const calls: string[] = []
  const waits: number[] = []
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    calls.push(String(url))
    const next = responses.shift()
    if (!next) throw new Error("no more responses")
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  const http = createHttp({
    fetchImpl,
    sleep: async (ms) => {
      waits.push(ms)
    },
    random: () => 0,
  })
  return { http, calls, waits, fetchImpl }
}

describe("createHttp", () => {
  it("retries 429 / 5xx / network errors, honoring Retry-After", async () => {
    const { http, calls, waits } = setup([
      json({}, 429, { "Retry-After": "3" }),
      json({}, 503),
      new TypeError("Failed to fetch"),
      json({ ok: 1 }),
    ])
    await expect(http.getJson("https://www.patreon.com/api/x")).resolves.toEqual({ ok: 1 })
    expect(calls).toHaveLength(4)
    expect(waits).toContain(3000)
  })

  it("gives up after 3 retries", async () => {
    const { http, calls } = setup([json({}, 500), json({}, 500), json({}, 500), json({}, 500), json({}, 200)])
    await expect(http.getJson("https://www.patreon.com/api/x")).rejects.toBeInstanceOf(HttpError)
    expect(calls).toHaveLength(4)
  })

  it("does not retry other 4xx", async () => {
    const { http, calls } = setup([json({}, 404)])
    await expect(http.getJson("https://www.patreon.com/api/x")).rejects.toMatchObject({ status: 404 })
    expect(calls).toHaveLength(1)
  })

  it("parses Retry-After dates and caps it", () => {
    expect(retryAfterMs("120")).toBe(60_000)
    expect(retryAfterMs(new Date(1_000_000 + 5000).toUTCString(), 1_000_000)).toBe(5000)
    expect(retryAfterMs(null)).toBeNull()
  })
})

describe("fetchPostContent", () => {
  it("uses the API content", async () => {
    const { http } = setup([json({ data: { id: "1", attributes: { title: "Ch 1", content: "<p>Hi</p>" } } })])
    expect(await fetchPostContent({ id: "1" }, http)).toMatchObject({ ok: true, title: "Ch 1", html: "<p>Hi</p>" })
  })

  it("reports a locked post as skipped", async () => {
    const { http } = setup([json({ data: { id: "1", attributes: { title: "Ch 1", content: null, current_user_can_view: false } } })])
    expect(await fetchPostContent({ id: "1" }, http)).toMatchObject({ ok: false, reason: expect.stringMatching(/locked/) })
    const forbidden = setup([json({}, 403)])
    expect(await fetchPostContent({ id: "1", title: "T" }, forbidden.http)).toMatchObject({ ok: false, title: "T" })
  })

  it("falls back to the post page when the API fails", async () => {
    const page =
      '<span data-tag="post-title">Ch 2</span><div class="patreon-post-content"><div class="RichText-module__ab__root"><p>Body</p></div></div>'
    const { http, calls } = setup([json({}, 400), new Response(page, { status: 200 })])
    expect(await fetchPostContent({ id: "2" }, http)).toMatchObject({ ok: true, title: "Ch 2", html: "<p>Body</p>" })
    expect(calls[1]).toBe("https://www.patreon.com/posts/2")
  })
})
