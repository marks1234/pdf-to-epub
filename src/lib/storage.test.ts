import { describe, it, expect } from "vitest"

import type { Chapter } from "@/lib/pdf-to-epub"
import {
  HARD_BYTE_BUDGET,
  HISTORY_CAP,
  QUOTA_FRACTION,
  computeByteBudget,
  estimateChaptersBytes,
  recordBytes,
  selectPruneVictims,
  splitChapters,
  type OutputRecord,
  type PruneCandidate,
} from "./storage"

/**
 * `fake-indexeddb` is not a dependency of this project, so the IDB plumbing is
 * exercised manually. The accounting that decides *what* gets thrown away lives
 * in pure functions, and that is what is asserted here.
 */

function candidate(
  id: string,
  createdAt: number,
  size = 0,
  chaptersSize = 0,
): PruneCandidate {
  return { id, createdAt, size, chaptersSize }
}

function chapter(title: string, texts: string[]): Chapter {
  return { title, blocks: texts.map((text) => ({ type: "p" as const, text })) }
}

function record(over: Partial<OutputRecord> = {}): OutputRecord {
  return {
    id: "a",
    kind: "epub",
    filename: "a.epub",
    blob: new Blob(["x"]),
    title: "A",
    author: "",
    sources: ["a.pdf"],
    pageCount: 1,
    size: 100,
    createdAt: 1,
    ...over,
  }
}

describe("estimateChaptersBytes", () => {
  it("is zero for missing or empty chapter lists", () => {
    expect(estimateChaptersBytes(undefined)).toBe(0)
    expect(estimateChaptersBytes([])).toBe(0)
  })

  it("counts title and block text as UTF-16 plus per-item overhead", () => {
    // title 2 chars + 16, one block of 3 chars + 8 => 29 chars => 58 bytes
    expect(estimateChaptersBytes([chapter("Ch", ["abc"])])).toBe(58)
  })

  it("grows with more text", () => {
    const small = estimateChaptersBytes([chapter("Ch", ["abc"])])
    const big = estimateChaptersBytes([chapter("Ch", ["abc", "defgh"])])
    expect(big).toBeGreaterThan(small)
  })

  it("adds up across chapters", () => {
    const one = estimateChaptersBytes([chapter("Ch", ["abc"])])
    const two = estimateChaptersBytes([chapter("Ch", ["abc"]), chapter("Ch", ["abc"])])
    expect(two).toBe(one * 2)
  })
})

describe("recordBytes", () => {
  it("sums blob size and chapter size", () => {
    expect(recordBytes(candidate("a", 1, 100, 25))).toBe(125)
  })

  it("treats missing fields as zero", () => {
    expect(recordBytes({ id: "a", createdAt: 1 })).toBe(0)
  })
})

describe("computeByteBudget", () => {
  it("falls back to the hard cap when no quota is reported", () => {
    expect(computeByteBudget(null)).toBe(HARD_BYTE_BUDGET)
    expect(computeByteBudget(undefined)).toBe(HARD_BYTE_BUDGET)
    expect(computeByteBudget(0)).toBe(HARD_BYTE_BUDGET)
    expect(computeByteBudget(Number.POSITIVE_INFINITY)).toBe(HARD_BYTE_BUDGET)
  })

  it("uses a fraction of a small quota", () => {
    expect(computeByteBudget(1000)).toBe(1000 * QUOTA_FRACTION)
  })

  it("never exceeds the hard cap on a huge quota", () => {
    expect(computeByteBudget(100 * HARD_BYTE_BUDGET)).toBe(HARD_BYTE_BUDGET)
  })

  it("honours an explicit cap argument", () => {
    expect(computeByteBudget(1000, 500)).toBe(500)
    expect(computeByteBudget(400, 500)).toBe(320)
  })
})

describe("selectPruneVictims", () => {
  it("evicts nothing when comfortably inside both limits", () => {
    const recs = [candidate("a", 1, 10), candidate("b", 2, 10)]
    expect(selectPruneVictims(recs, { byteBudget: 1000 })).toEqual([])
  })

  it("evicts oldest first past the count cap", () => {
    const recs = [
      candidate("new", 300),
      candidate("old", 100),
      candidate("mid", 200),
    ]
    expect(selectPruneVictims(recs, { countCap: 1 })).toEqual(["old", "mid"])
  })

  it("defaults the count cap to HISTORY_CAP", () => {
    const recs = Array.from({ length: HISTORY_CAP + 2 }, (_, i) =>
      candidate(`r${i}`, i),
    )
    expect(selectPruneVictims(recs)).toEqual(["r0", "r1"])
  })

  it("evicts oldest first past the byte budget", () => {
    const recs = [
      candidate("old", 1, 60),
      candidate("mid", 2, 60),
      candidate("new", 3, 60),
    ]
    // total 180, budget 130 -> dropping the oldest alone brings it to 120
    expect(selectPruneVictims(recs, { byteBudget: 130 })).toEqual(["old"])
    // budget 100 needs two gone
    expect(selectPruneVictims(recs, { byteBudget: 100 })).toEqual(["old", "mid"])
  })

  it("counts chapter bytes toward the budget", () => {
    const recs = [candidate("old", 1, 50, 50), candidate("new", 2, 50, 0)]
    expect(selectPruneVictims(recs, { byteBudget: 120 })).toEqual(["old"])
  })

  it("makes room for an incoming record", () => {
    const recs = [candidate("old", 1, 50), candidate("new", 2, 50)]
    expect(selectPruneVictims(recs, { byteBudget: 100 })).toEqual([])
    expect(
      selectPruneVictims(recs, { byteBudget: 100, incomingBytes: 50 }),
    ).toEqual(["old"])
  })

  it("counts an incoming record against the count cap", () => {
    const recs = [candidate("old", 1), candidate("new", 2)]
    expect(selectPruneVictims(recs, { countCap: 2 })).toEqual([])
    expect(selectPruneVictims(recs, { countCap: 2, incomingCount: 1 })).toEqual([
      "old",
    ])
  })

  it("respects keepAtLeast even when still over budget", () => {
    const recs = [candidate("old", 1, 500), candidate("new", 2, 500)]
    expect(selectPruneVictims(recs, { byteBudget: 1, keepAtLeast: 1 })).toEqual([
      "old",
    ])
  })

  it("can empty the store when keepAtLeast is 0", () => {
    const recs = [candidate("old", 1, 500), candidate("new", 2, 500)]
    expect(selectPruneVictims(recs, { byteBudget: 1 })).toEqual(["old", "new"])
  })

  it("is unlimited on bytes by default", () => {
    const recs = [candidate("a", 1, Number.MAX_SAFE_INTEGER)]
    expect(selectPruneVictims(recs)).toEqual([])
  })

  it("breaks createdAt ties deterministically on id", () => {
    const recs = [candidate("b", 5), candidate("a", 5), candidate("c", 5)]
    expect(selectPruneVictims(recs, { countCap: 1 })).toEqual(["a", "b"])
  })

  it("does not mutate the input array order", () => {
    const recs = [candidate("new", 3), candidate("old", 1)]
    selectPruneVictims(recs, { countCap: 1 })
    expect(recs.map((r) => r.id)).toEqual(["new", "old"])
  })

  it("handles an empty history", () => {
    expect(selectPruneVictims([], { countCap: 0, byteBudget: 0 })).toEqual([])
  })
})

describe("splitChapters (v2 -> v3 migration transform)", () => {
  it("lifts embedded chapters out of the record", () => {
    const chapters = [chapter("One", ["hello"])]
    const split = splitChapters(record({ chapters }))
    expect(split.chapters).toEqual(chapters)
    expect("chapters" in split.record).toBe(false)
  })

  it("flags and sizes the lifted chapters", () => {
    const chapters = [chapter("One", ["hello"])]
    const split = splitChapters(record({ chapters }))
    expect(split.record.hasChapters).toBe(true)
    expect(split.record.chaptersSize).toBe(estimateChaptersBytes(chapters))
  })

  it("marks a record with no chapters as having none", () => {
    const split = splitChapters(record())
    expect(split.chapters).toBeUndefined()
    expect(split.record.hasChapters).toBe(false)
    expect(split.record.chaptersSize).toBe(0)
  })

  it("treats an empty chapter array as no chapters", () => {
    const split = splitChapters(record({ chapters: [] }))
    expect(split.chapters).toBeUndefined()
    expect(split.record.hasChapters).toBe(false)
  })

  it("preserves an existing hasChapters flag when no chapters are supplied", () => {
    // This is the restyle path: App re-saves the record without chapter text.
    const split = splitChapters(record({ hasChapters: true, chaptersSize: 42 }))
    expect(split.record.hasChapters).toBe(true)
    expect(split.record.chaptersSize).toBe(42)
    expect(split.chapters).toBeUndefined()
  })

  it("keeps the rest of the record intact", () => {
    const split = splitChapters(
      record({ id: "z", title: "T", size: 7, chapters: [chapter("C", ["x"])] }),
    )
    expect(split.record.id).toBe("z")
    expect(split.record.title).toBe("T")
    expect(split.record.size).toBe(7)
  })

  it("does not mutate the input record", () => {
    const rec = record({ chapters: [chapter("One", ["hello"])] })
    splitChapters(rec)
    expect(rec.chapters).toHaveLength(1)
  })
})
