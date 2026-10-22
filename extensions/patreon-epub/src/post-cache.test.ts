import { afterEach, describe, it, expect } from "vitest"

import { clear, getMany, prune, put } from "./post-cache"
import type { PostResult } from "./posts"

type G = { chrome?: unknown }

function fakeStorage(opts: { failSet?: boolean } = {}) {
  const data: Record<string, unknown> = {}
  ;(globalThis as G).chrome = {
    storage: {
      local: {
        get: async (keys: string[] | null) => (keys ? Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])) : { ...data }),
        set: async (items: Record<string, unknown>) => {
          if (opts.failSet) throw new Error("QUOTA_BYTES quota exceeded")
          Object.assign(data, items)
        },
        remove: async (keys: string[]) => keys.forEach((k) => delete data[k]),
      },
    },
  }
  return data
}

afterEach(() => {
  delete (globalThis as G).chrome
})

const ok = (id: string): PostResult => ({ ok: true, id, title: `T${id}`, html: "<p>x</p>", publishedAt: "2026-01-01" })

describe("post-cache", () => {
  it("round-trips successes and ignores failures", async () => {
    fakeStorage()
    await put(ok("1"))
    await put({ ok: false, id: "2", title: "x", reason: "r", kind: "locked" })
    const got = await getMany(["1", "2", "3"])
    expect([...got.keys()]).toEqual(["1"])
    expect(got.get("1")).toMatchObject({ ok: true, title: "T1", html: "<p>x</p>" })
  })

  it("a quota error is a silent miss", async () => {
    fakeStorage({ failSet: true })
    await expect(put(ok("1"))).resolves.toBeUndefined()
    expect((await getMany(["1"])).size).toBe(0)
  })

  it("works without chrome at all", async () => {
    await expect(put(ok("1"))).resolves.toBeUndefined()
    expect((await getMany(["1"])).size).toBe(0)
    await expect(clear()).resolves.toBeUndefined()
  })

  it("prunes old entries and clears everything", async () => {
    const data = fakeStorage()
    await put(ok("1"))
    data["pc:v1:old"] = { v: 1, title: "o", html: "", savedAt: 0 }
    data["other"] = 1
    await prune(1000, Date.now())
    expect(Object.keys(data).sort()).toEqual(["other", "pc:v1:1"])
    await clear()
    expect(Object.keys(data)).toEqual(["other"])
  })
})
