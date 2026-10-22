import { beforeEach, describe, it, expect } from "vitest"

import { describeUrl, log, logAttempt, logShape, reset, text } from "./diag"

beforeEach(reset)

describe("diag", () => {
  it("logs query keys, never values", () => {
    expect(describeUrl("https://www.patreon.com/api/posts?filter%5Bcollection_id%5D=552396&sort=x")).toBe(
      "/api/posts?filter[collection_id]&sort",
    )
    logAttempt({ url: "https://www.patreon.com/api/posts/1?fields%5Bpost%5D=title", tryNo: 0, ms: 12, status: 403, contentType: "text/html; charset=utf-8", cfMitigated: "challenge" })
    expect(text()).toMatch(/http \/api\/posts\/1\?fields\[post\] try=0 status=403 ct=text\/html cf-mitigated=challenge 12ms/)
    expect(text()).not.toContain("title")
  })

  it("fingerprints each endpoint once, key names only", () => {
    const body = { data: { id: "1", attributes: { title: "Secret", content: null, content_json_string: "{}" } }, links: { self: "x" } }
    logShape("https://www.patreon.com/api/posts/1?x=1", body)
    logShape("https://www.patreon.com/api/posts/2", body)
    const t = text()
    expect(t.match(/shape/g)).toHaveLength(1)
    expect(t).toContain("attrs=[content,content_json_string,title]")
    expect(t).not.toContain("Secret")
  })

  it("keeps the last 300 lines", () => {
    for (let i = 0; i < 350; i++) log(`line ${i}`)
    const t = text().split("\n")
    expect(t).toHaveLength(302)
    expect(t[2]).toContain("line 50")
  })
})
