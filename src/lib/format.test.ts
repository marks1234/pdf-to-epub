import { describe, expect, it } from "vitest"

import { sanitizeFilename } from "./format"

describe("sanitizeFilename", () => {
  it("keeps ordinary titles untouched", () => {
    expect(sanitizeFilename("Player's Handbook - Part 2")).toBe(
      "Player's Handbook - Part 2",
    )
  })

  it("replaces filesystem-reserved characters", () => {
    expect(sanitizeFilename('Rules: "Combat" <v2>')).toBe("Rules Combat v2")
    expect(sanitizeFilename("a/b\\c:d*e?f|g")).toBe("a b c d e f g")
  })

  it("strips control characters", () => {
    const bell = String.fromCharCode(7)
    expect(sanitizeFilename(`Book${bell}One`)).toBe("Book One")
  })

  it("collapses whitespace runs and newlines", () => {
    expect(sanitizeFilename("  Big    Book \n of   Things ")).toBe(
      "Big Book of Things",
    )
  })

  it("trims leading and trailing dots and spaces", () => {
    expect(sanitizeFilename("...hidden...")).toBe("hidden")
    expect(sanitizeFilename("trailing.")).toBe("trailing")
    expect(sanitizeFilename(".")).toBe("untitled")
  })

  it("falls back to untitled for empty or fully stripped input", () => {
    expect(sanitizeFilename("")).toBe("untitled")
    expect(sanitizeFilename("   ")).toBe("untitled")
    expect(sanitizeFilename("///")).toBe("untitled")
    expect(sanitizeFilename(undefined as unknown as string)).toBe("untitled")
  })

  it("caps the length and leaves no trailing space", () => {
    const long = "word ".repeat(60)
    const out = sanitizeFilename(long)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out).toBe(out.trim())
  })

  it("never yields a path separator", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etc passwd")
  })
})
