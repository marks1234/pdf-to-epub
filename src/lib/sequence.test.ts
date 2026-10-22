import { describe, it, expect } from "vitest"

import {
  analyzeSequence,
  extractNumber,
  formatNumberRanges,
  rangeBetween,
} from "./sequence"

describe("extractNumber — keyword + number forms", () => {
  it("pulls the chapter number out of a real queue file name", () => {
    // The thousands separator in "(2,509 words)" must not win over "Chapter 22".
    expect(extractNumber("Chapter 22 (2,509 words).pdf")).toEqual({
      num: 22,
      label: "Chapter",
    })
  })

  it("accepts an abbreviated keyword with a trailing dot and zero padding", () => {
    expect(extractNumber("Ch. 07 - The Descent.pdf")).toEqual({
      num: 7,
      label: "Chapter",
    })
  })

  it("accepts a dash or hash between the keyword and the number", () => {
    expect(extractNumber("Part-12.pdf")).toEqual({ num: 12, label: "Part" })
    expect(extractNumber("Part #12.pdf")).toEqual({ num: 12, label: "Part" })
  })

  it("is case-insensitive and canonicalises the label", () => {
    expect(extractNumber("CHAPTER 5.pdf").label).toBe("Chapter")
    expect(extractNumber("chap 5.pdf").label).toBe("Chapter")
    expect(extractNumber("ch 5.pdf").label).toBe("Chapter")
  })

  it("maps every keyword family to its canonical label", () => {
    expect(extractNumber("Part 3.pdf").label).toBe("Part")
    expect(extractNumber("pt 3.pdf").label).toBe("Part")
    expect(extractNumber("Section 3.pdf").label).toBe("Section")
    expect(extractNumber("sect 3.pdf").label).toBe("Section")
    expect(extractNumber("sec 3.pdf").label).toBe("Section")
    expect(extractNumber("Page 3.pdf").label).toBe("Page")
    expect(extractNumber("pg 3.pdf").label).toBe("Page")
    expect(extractNumber("Volume 3.pdf").label).toBe("Volume")
    expect(extractNumber("vol 3.pdf").label).toBe("Volume")
    expect(extractNumber("Episode 3.pdf").label).toBe("Episode")
    expect(extractNumber("ep 3.pdf").label).toBe("Episode")
    expect(extractNumber("Book 3.pdf").label).toBe("Book")
    expect(extractNumber("Unit 3.pdf").label).toBe("Unit")
    expect(extractNumber("Lesson 3.pdf").label).toBe("Lesson")
    expect(extractNumber("No. 3.pdf").label).toBe("No.")
  })

  it("prefers the keyword form over an earlier bare number", () => {
    expect(extractNumber("2024 Chapter 5.pdf")).toEqual({
      num: 5,
      label: "Chapter",
    })
  })

  it("does not treat a keyword embedded in a longer word as a keyword", () => {
    // "sec" inside "Search" has no word boundary after it.
    expect(extractNumber("Search 5.pdf")).toEqual({ num: 5, label: null })
    // "ch3" — no boundary between the keyword and the digits either.
    expect(extractNumber("ch3.pdf")).toEqual({ num: 3, label: null })
  })
})

describe("extractNumber — bare-number fallback", () => {
  it("uses the first standalone integer when there is no keyword", () => {
    expect(extractNumber("03 - Prologue.pdf")).toEqual({ num: 3, label: null })
    expect(extractNumber("draft 17 final.pdf")).toEqual({ num: 17, label: null })
  })

  it("strips the file extension before looking", () => {
    expect(extractNumber("7.pdf")).toEqual({ num: 7, label: null })
  })

  it("ignores numbers that are part of a thousands group or a decimal", () => {
    expect(extractNumber("report (2,509 words).pdf")).toEqual({
      num: null,
      label: null,
    })
    expect(extractNumber("v1.5 notes.pdf")).toEqual({ num: null, label: null })
  })

  it("returns nulls when there is no number at all", () => {
    expect(extractNumber("cover.pdf")).toEqual({ num: null, label: null })
    expect(extractNumber("")).toEqual({ num: null, label: null })
  })
})

const chapters = (...ns: number[]) => ns.map((n) => `Chapter ${n}.pdf`)

describe("analyzeSequence — gates", () => {
  it("needs at least three numbered files", () => {
    const two = analyzeSequence(chapters(1, 2))
    expect(two.hasOrder).toBe(false)
    expect(two.numbers).toEqual([1, 2])

    expect(analyzeSequence(chapters(1, 2, 3)).hasOrder).toBe(true)
  })

  it("rejects a set where every file carries the same number (max <= min)", () => {
    const info = analyzeSequence(chapters(1, 1, 1))
    expect(info.hasOrder).toBe(false)
    expect(info.min).toBeNull()
    expect(info.max).toBeNull()
  })

  it("rejects an absurdly wide range", () => {
    expect(analyzeSequence(chapters(1, 2, 6000)).hasOrder).toBe(false)
  })

  it("applies the density gate at 0.6", () => {
    // 3 unique numbers over a range of 5 => density 0.6, exactly on the line.
    expect(analyzeSequence(chapters(1, 2, 5)).hasOrder).toBe(true)
    // 3 unique over a range of 6 => density 0.5, just under.
    expect(analyzeSequence(chapters(1, 2, 6)).hasOrder).toBe(false)
  })

  it("applies the coverage gate at 0.6", () => {
    const onTheLine = analyzeSequence([
      ...chapters(1, 2, 3),
      "cover.pdf",
      "afterword.pdf",
    ])
    expect(onTheLine.hasOrder).toBe(true) // 3/5 = 0.6

    const under = analyzeSequence([
      ...chapters(1, 2, 3),
      "cover.pdf",
      "afterword.pdf",
      "colophon.pdf",
    ])
    expect(under.hasOrder).toBe(false) // 3/6 = 0.5
    expect(under.numbers).toEqual([1, 2, 3, null, null, null])
  })
})

describe("analyzeSequence — results", () => {
  it("reports gaps inside the range", () => {
    const info = analyzeSequence(chapters(1, 2, 4, 5))
    expect(info.hasOrder).toBe(true)
    expect(info.missing).toEqual([3])
    expect(info.min).toBe(1)
    expect(info.max).toBe(5)
    expect(info.label).toBe("Chapter")
  })

  it("reports several gaps ascending", () => {
    expect(analyzeSequence(chapters(1, 2, 4, 6, 7, 8, 9, 10)).missing).toEqual([
      3, 5,
    ])
  })

  it("reports no gaps for a contiguous run", () => {
    const info = analyzeSequence(chapters(4, 5, 6, 7))
    expect(info.missing).toEqual([])
    expect(info.duplicates).toEqual([])
  })

  it("reports duplicates ascending without treating them as gaps", () => {
    const info = analyzeSequence(chapters(1, 3, 2, 3, 1, 4))
    expect(info.hasOrder).toBe(true)
    expect(info.duplicates).toEqual([1, 3])
    expect(info.missing).toEqual([])
  })

  it("handles unsorted input and keeps `numbers` in input order", () => {
    const info = analyzeSequence(chapters(3, 1, 2))
    expect(info.numbers).toEqual([3, 1, 2])
    expect(info.min).toBe(1)
    expect(info.max).toBe(3)
    expect(info.hasOrder).toBe(true)
  })

  it("picks the most common keyword label", () => {
    const info = analyzeSequence([
      "Chapter 1.pdf",
      "Chapter 2.pdf",
      "Part 3.pdf",
    ])
    expect(info.label).toBe("Chapter")
  })

  it("leaves the label null for bare-number sequences", () => {
    const info = analyzeSequence(["1.pdf", "2.pdf", "3.pdf"])
    expect(info.hasOrder).toBe(true)
    expect(info.label).toBeNull()
  })

  it("returns an empty analysis for an empty input", () => {
    const info = analyzeSequence([])
    expect(info).toEqual({
      hasOrder: false,
      numbers: [],
      missing: [],
      duplicates: [],
      label: null,
      min: null,
      max: null,
    })
  })
})

describe("formatNumberRanges", () => {
  it("returns an empty string for no numbers", () => {
    expect(formatNumberRanges([])).toBe("")
  })

  it("formats a single number", () => {
    expect(formatNumberRanges([5])).toBe("5")
  })

  it("collapses a run into an en-dash range", () => {
    expect(formatNumberRanges([1, 2, 3])).toBe("1–3")
  })

  it("mixes singles and runs", () => {
    expect(formatNumberRanges([27, 31, 32])).toBe("27, 31–32")
    expect(formatNumberRanges([10, 11, 12, 20, 21, 30])).toBe("10–12, 20–21, 30")
  })

  it("keeps non-adjacent numbers separate", () => {
    expect(formatNumberRanges([1, 3, 5])).toBe("1, 3, 5")
  })

  it("sorts before formatting", () => {
    expect(formatNumberRanges([3, 1, 2])).toBe("1–3")
  })

  it("does not mutate its input", () => {
    const nums = [3, 1, 2]
    formatNumberRanges(nums)
    expect(nums).toEqual([3, 1, 2])
  })
})

describe("rangeBetween", () => {
  it("returns the integers strictly between the bounds", () => {
    expect(rangeBetween(26, 28)).toEqual([27])
    expect(rangeBetween(1, 5)).toEqual([2, 3, 4])
  })

  it("returns nothing for adjacent, equal or reversed bounds", () => {
    expect(rangeBetween(1, 2)).toEqual([])
    expect(rangeBetween(3, 3)).toEqual([])
    expect(rangeBetween(5, 1)).toEqual([])
  })
})
