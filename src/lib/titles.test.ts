import { describe, it, expect } from "vitest"

import {
  DEFAULT_RENAME_PATTERN,
  chapterTitle,
  expandTitlePattern,
  kindleSeriesTitle,
} from "./titles"

describe("chapterTitle", () => {
  it("uses the keyword and number when the name carries one", () => {
    expect(chapterTitle("Chapter 22 (2,509 words).pdf")).toBe("Chapter 22")
    expect(chapterTitle("ch 07.pdf")).toBe("Chapter 7")
  })

  it("cleans up a name with no recognizable sequence keyword", () => {
    expect(chapterTitle("the_final_stand.pdf")).toBe("the final stand")
    expect(chapterTitle("Prologue (draft).pdf")).toBe("Prologue")
  })

  it("falls back to the bare stem when cleaning empties it", () => {
    expect(chapterTitle("(draft).pdf")).toBe("(draft)")
  })
})

describe("expandTitlePattern", () => {
  it("defaults to numbering by position", () => {
    expect(expandTitlePattern(DEFAULT_RENAME_PATTERN, 1, "anything.pdf")).toBe(
      "Chapter 1",
    )
    expect(expandTitlePattern(DEFAULT_RENAME_PATTERN, 12, "anything.pdf")).toBe(
      "Chapter 12",
    )
  })

  it("{num} takes the number out of the file name", () => {
    expect(expandTitlePattern("Chapter {num}", 1, "Chapter 41.pdf")).toBe(
      "Chapter 41",
    )
    expect(expandTitlePattern("{num}", 3, "ch_07 (words).pdf")).toBe("7")
  })

  it("{num} falls back to the position when the name has no number", () => {
    expect(expandTitlePattern("Chapter {num}", 5, "prologue.pdf")).toBe(
      "Chapter 5",
    )
  })

  it("replaces every occurrence of each token", () => {
    expect(expandTitlePattern("{n} of {n} — {num}", 2, "ch 9.pdf")).toBe(
      "2 of 2 — 9",
    )
  })

  it("keeps everything else literal", () => {
    expect(expandTitlePattern("Vol 2 — Part {n}", 3, "x.pdf")).toBe(
      "Vol 2 — Part 3",
    )
    expect(expandTitlePattern("No tokens here", 3, "x.pdf")).toBe(
      "No tokens here",
    )
  })

  it("leaves unknown braces alone", () => {
    expect(expandTitlePattern("{nope} {n}", 4, "x.pdf")).toBe("{nope} 4")
  })

  it("trims the result and can produce an empty string", () => {
    expect(expandTitlePattern("  {n}  ", 1, "x.pdf")).toBe("1")
    expect(expandTitlePattern("   ", 1, "x.pdf")).toBe("")
    expect(expandTitlePattern("", 1, "x.pdf")).toBe("")
  })
})

describe("kindleSeriesTitle", () => {
  it("zero-pads the index to two digits", () => {
    expect(kindleSeriesTitle("Quest Academy", 3, "Rise of the Guild")).toBe(
      "Quest Academy 03 — Rise of the Guild",
    )
  })

  it("leaves indexes of 10 or more unpadded", () => {
    expect(kindleSeriesTitle("Quest Academy", 12, "Endgame")).toBe(
      "Quest Academy 12 — Endgame",
    )
    expect(kindleSeriesTitle("Quest Academy", 104, "Endgame")).toBe(
      "Quest Academy 104 — Endgame",
    )
  })

  it("trims the series and title", () => {
    expect(kindleSeriesTitle("  Saga  ", 1, "  Book One  ")).toBe(
      "Saga 01 — Book One",
    )
  })

  it("floors a fractional index and never drops below 1", () => {
    expect(kindleSeriesTitle("Saga", 2.7, "T")).toBe("Saga 02 — T")
    expect(kindleSeriesTitle("Saga", 0, "T")).toBe("Saga 01 — T")
    expect(kindleSeriesTitle("Saga", -4, "T")).toBe("Saga 01 — T")
  })

  it("sorts volumes of one series adjacently as plain strings", () => {
    const titles = [10, 2, 1].map((n) => kindleSeriesTitle("Saga", n, "T"))
    expect([...titles].sort()).toEqual([
      "Saga 01 — T",
      "Saga 02 — T",
      "Saga 10 — T",
    ])
  })
})
