import { describe, expect, it } from "vitest"

import { moveGroup, rangeIds } from "@/lib/reorder"

const list = (...ids: string[]) => ids.map((id) => ({ id }))
const ids = (l: readonly { id: string }[]) => l.map((i) => i.id)

describe("moveGroup", () => {
  const abcdef = list("a", "b", "c", "d", "e", "f")

  it("moves a single item down (no selection)", () => {
    expect(ids(moveGroup(abcdef, new Set(), "a", "c"))).toEqual([
      "b", "c", "a", "d", "e", "f",
    ])
  })

  it("moves a single item up", () => {
    expect(ids(moveGroup(abcdef, new Set(), "e", "b"))).toEqual([
      "a", "e", "b", "c", "d", "f",
    ])
  })

  it("treats a single-member selection as a plain move", () => {
    expect(ids(moveGroup(abcdef, new Set(["a"]), "a", "c"))).toEqual([
      "b", "c", "a", "d", "e", "f",
    ])
  })

  it("moves a contiguous group down, inserting after the target", () => {
    expect(ids(moveGroup(abcdef, new Set(["a", "b"]), "a", "d"))).toEqual([
      "c", "d", "a", "b", "e", "f",
    ])
  })

  it("moves a contiguous group up, inserting before the target", () => {
    expect(ids(moveGroup(abcdef, new Set(["e", "f"]), "e", "b"))).toEqual([
      "a", "e", "f", "b", "c", "d",
    ])
  })

  it("gathers a non-contiguous selection at the drop position, keeping order", () => {
    expect(ids(moveGroup(abcdef, new Set(["b", "d", "f"]), "d", "a"))).toEqual([
      "b", "d", "f", "a", "c", "e",
    ])
  })

  it("moving a scattered group to the end", () => {
    expect(ids(moveGroup(abcdef, new Set(["a", "c"]), "a", "f"))).toEqual([
      "b", "d", "e", "f", "a", "c",
    ])
  })

  it("is a no-op when dropping onto a member of the group", () => {
    expect(moveGroup(abcdef, new Set(["a", "b"]), "a", "b")).toBe(abcdef)
  })

  it("is a no-op when dropping an item onto itself", () => {
    expect(moveGroup(abcdef, new Set(), "c", "c")).toBe(abcdef)
  })

  it("is a no-op for unknown ids", () => {
    expect(moveGroup(abcdef, new Set(), "zz", "a")).toBe(abcdef)
    expect(moveGroup(abcdef, new Set(), "a", "zz")).toBe(abcdef)
  })

  it("dragging an unselected item ignores the selection", () => {
    expect(ids(moveGroup(abcdef, new Set(["e", "f"]), "a", "c"))).toEqual([
      "b", "c", "a", "d", "e", "f",
    ])
  })
})

describe("rangeIds", () => {
  const l = list("a", "b", "c", "d")

  it("returns an inclusive range", () => {
    expect(rangeIds(l, 1, 3)).toEqual(["b", "c", "d"])
  })

  it("works with reversed indices", () => {
    expect(rangeIds(l, 3, 1)).toEqual(["b", "c", "d"])
  })

  it("single index", () => {
    expect(rangeIds(l, 2, 2)).toEqual(["c"])
  })
})
