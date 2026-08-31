import { describe, it, expect } from "vitest"

import { pickSampleBlocks, type SampleChapter } from "./preview-sample"
import type { Block } from "./reconstruct"

const prose = (text: string): Block => ({ type: "p", text })
const stat = (text: string): Block => ({ type: "li", text })

/** `n` prose blocks numbered from `from`, so slices are identifiable. */
function proseRun(from: number, count: number): Block[] {
  return Array.from({ length: count }, (_, i) => prose(`prose ${from + i}`))
}

function chapter(title: string, blocks: Block[]): SampleChapter {
  return { title, blocks }
}

describe("pickSampleBlocks", () => {
  it("returns nothing when there are no chapters", () => {
    expect(pickSampleBlocks(undefined)).toEqual([])
    expect(pickSampleBlocks([])).toEqual([])
  })

  it("falls back to the longest chapter's opening when nothing looks stat-like", () => {
    const picked = pickSampleBlocks(
      [chapter("One", proseRun(0, 3)), chapter("Two", proseRun(100, 40))],
      10,
      15,
    )
    expect(picked).toHaveLength(15)
    expect(picked[0]).toEqual(prose("prose 100"))
    expect(picked[14]).toEqual(prose("prose 114"))
  })

  it("returns the whole chapter when the fallback is longer than it", () => {
    expect(pickSampleBlocks([chapter("One", proseRun(0, 4))], 10, 15)).toHaveLength(4)
  })

  it("centres the window on a stat run and pads it with surrounding prose", () => {
    const blocks = [
      ...proseRun(0, 20),
      stat("[Common] Switcher has been killed."),
      stat("Reactor: [4.9%] [9/180]"),
      ...proseRun(50, 20),
    ]
    const picked = pickSampleBlocks([chapter("One", blocks)], 10, 15)

    expect(picked).toHaveLength(10)
    expect(picked).toContainEqual(stat("[Common] Switcher has been killed."))
    expect(picked).toContainEqual(stat("Reactor: [4.9%] [9/180]"))
    // 4 prose blocks before the 2-block run, 4 after.
    expect(picked[0]).toEqual(prose("prose 16"))
    expect(picked[9]).toEqual(prose("prose 53"))
  })

  it("keeps the entire run when it is longer than the context window", () => {
    const run = Array.from({ length: 18 }, (_, i) => stat(`[Line ${i}] 12%`))
    const picked = pickSampleBlocks([chapter("One", [...proseRun(0, 5), ...run])], 10, 15)

    expect(picked).toHaveLength(18)
    expect(picked).toEqual(expect.arrayContaining(run))
  })

  it("prefers the longest stat run across every chapter", () => {
    const short = [stat("[A] 1%"), stat("[B] 2%")]
    const long = [stat("[C] 3%"), stat("[D] 4%"), stat("[E] 5%"), stat("[F] 6%")]
    const picked = pickSampleBlocks(
      [chapter("One", [...proseRun(0, 5), ...short]), chapter("Two", [...proseRun(100, 5), ...long])],
      10,
      15,
    )

    expect(picked).toContainEqual(stat("[C] 3%"))
    expect(picked).not.toContainEqual(stat("[A] 1%"))
  })

  it("clamps the window to the chapter when the run sits at an edge", () => {
    const blocks = [stat("[Start] 5%"), stat("[Start] 6%"), ...proseRun(0, 30)]
    const picked = pickSampleBlocks([chapter("One", blocks)], 10, 15)

    expect(picked).toHaveLength(10)
    expect(picked[0]).toEqual(stat("[Start] 5%"))
    expect(picked[9]).toEqual(prose("prose 7"))
  })

  it("ignores scene-break blocks when hunting for stat content", () => {
    const blocks = [...proseRun(0, 4), { type: "hr", text: "* * *" } as Block, ...proseRun(10, 4)]
    // No stat hints at all → fallback path, so the very first block is returned.
    expect(pickSampleBlocks([chapter("One", blocks)], 10, 15)[0]).toEqual(prose("prose 0"))
  })
})
