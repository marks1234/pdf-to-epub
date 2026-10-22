import { describe, it, expect, vi } from "vitest"

import { HttpError, NotJsonError, type Http } from "./http"
import { ApiShapeError } from "./patreon-api"
import { fetchPostContent } from "./posts"

const PAGE =
  '<span data-tag="post-title">Ch 2</span><div class="patreon-post-content"><div class="RichText-module__ab__root"><p>Body</p></div></div>'

function fake(json: unknown | Error, page: string | Error = PAGE) {
  const http = {
    getJson: vi.fn(async () => {
      if (json instanceof Error) throw json
      return json
    }),
    getText: vi.fn(async () => {
      if (page instanceof Error) throw page
      return page
    }),
    getBytes: vi.fn(async () => new ArrayBuffer(0)),
  } satisfies Http
  return http
}
const U = "https://www.patreon.com/api/posts/1"

describe("fetchPostContent", () => {
  it("uses the API content", async () => {
    const http = fake({ data: { id: "1", attributes: { title: "Ch 1", content: "<p>Hi</p>" } } })
    expect(await fetchPostContent({ id: "1" }, http)).toMatchObject({ ok: true, title: "Ch 1", html: "<p>Hi</p>" })
  })

  it("a 429 is transient with no page fallback", async () => {
    const http = fake(new HttpError(429, U))
    expect(await fetchPostContent({ id: "1" }, http)).toMatchObject({ ok: false, kind: "transient" })
    expect(http.getText).not.toHaveBeenCalled()
    expect(await fetchPostContent({ id: "1" }, fake(new TypeError("Failed to fetch")))).toMatchObject({ kind: "transient" })
  })

  it("an ApiShapeError or a 400 still uses the page fallback", async () => {
    const http = fake(new ApiShapeError("bad"))
    expect(await fetchPostContent({ id: "2" }, http)).toMatchObject({ ok: true, title: "Ch 2", html: "<p>Body</p>" })
    expect(http.getText).toHaveBeenCalledWith("https://www.patreon.com/posts/2")
    expect(await fetchPostContent({ id: "2" }, fake(new HttpError(400, U)))).toMatchObject({ ok: true })
  })

  it("NotJsonError is auth, with no fallback", async () => {
    const http = fake(new NotJsonError(200, "text/html", U, false))
    expect(await fetchPostContent({ id: "1" }, http)).toMatchObject({ ok: false, kind: "auth" })
    expect(http.getText).not.toHaveBeenCalled()
  })

  it("403 is auth when HTML, locked when JSON; 404 is missing", async () => {
    expect(await fetchPostContent({ id: "1" }, fake(new HttpError(403, U, "text/html")))).toMatchObject({ kind: "auth" })
    expect(await fetchPostContent({ id: "1", title: "T" }, fake(new HttpError(403, U, "application/json")))).toMatchObject({ kind: "locked", title: "T" })
    expect(await fetchPostContent({ id: "1" }, fake(new HttpError(404, U)))).toMatchObject({ kind: "missing" })
  })

  it("a preview with can_view false is locked", async () => {
    const http = fake({ data: { id: "1", attributes: { title: "Ch", content: "<p>Preview…</p>", current_user_can_view: false } } })
    expect(await fetchPostContent({ id: "1" }, http)).toMatchObject({ ok: false, kind: "locked", reason: expect.stringMatching(/preview/) })
  })

  it("ref.canView === false makes no request", async () => {
    const http = fake({})
    expect(await fetchPostContent({ id: "1", canView: false }, http)).toMatchObject({ kind: "locked" })
    expect(http.getJson).not.toHaveBeenCalled()
  })

  it("an empty body that isn't locked falls through to the page", async () => {
    const http = fake({ data: { id: "1", attributes: { title: "Ch", content: null, content_json_string: "{bad" } } })
    expect(await fetchPostContent({ id: "1" }, http)).toMatchObject({ ok: true, html: "<p>Body</p>" })
    expect(http.getText).toHaveBeenCalled()
  })

  it("page failures: 5xx is transient, anything else empty", async () => {
    const shape = new ApiShapeError("bad")
    expect(await fetchPostContent({ id: "1" }, fake(shape, new HttpError(503, U)))).toMatchObject({ kind: "transient" })
    expect(await fetchPostContent({ id: "1" }, fake(shape, new HttpError(410, U)))).toMatchObject({ kind: "empty" })
    expect(await fetchPostContent({ id: "1" }, fake(shape, "<html></html>"))).toMatchObject({ kind: "empty" })
  })
})
