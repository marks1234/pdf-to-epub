import { describe, it, expect } from "vitest"

import {
  buildVocabulary,
  dehyphenate,
  dehyphenateAll,
  isSceneBreak,
  joinHyphenated,
  normalizeCharacters,
  normalizeHeaderCandidate,
  stripRunningHeadersFooters,
} from "./cleanup"

describe("normalizeCharacters", () => {
  it("expands the f-ligatures PDF fonts emit", () => {
    expect(normalizeCharacters("The ﬁrst ﬂame")).toBe("The first flame")
    expect(normalizeCharacters("ﬀ ﬃ ﬄ")).toBe("ff ffi ffl")
  })

  it("does NOT mangle the characters NFKC would rewrite", () => {
    // These are exactly the collateral damage a blanket NFKC pass causes; stat
    // sheets are full of superscripts, fractions and roman numerals.
    const risky = "10² ½ ⅓ № ⅠⅡ Ａ Æon œuvre"
    expect(normalizeCharacters(risky)).toBe(risky)
    // Sanity check that NFKC really would have changed it.
    expect(risky.normalize("NFKC")).not.toBe(risky)
  })

  it("strips soft hyphens unconditionally", () => {
    expect(normalizeCharacters("in­cred­ible")).toBe("incredible")
  })

  it("strips zero-width characters and normalizes hard spaces", () => {
    expect(normalizeCharacters("a​b‌c‍d﻿e")).toBe("abcde")
    expect(normalizeCharacters("50 %")).toBe("50 %")
    expect(normalizeCharacters("1 000 m")).toBe("1 000 m")
  })

  it("leaves ordinary prose untouched", () => {
    const prose = "He counted three exits — then waited."
    expect(normalizeCharacters(prose)).toBe(prose)
  })
})

describe("buildVocabulary", () => {
  it("collects lowercased alphabetic words only", () => {
    const vocab = buildVocabulary(["The Drone, 42 sensors!", "hovered"])
    expect([...vocab].sort()).toEqual(["drone", "hovered", "sensors", "the"])
  })
})

describe("joinHyphenated", () => {
  const vocab = buildVocabulary(["interesting understanding brightness rebuilding"])

  it("joins losslessly when the whole word occurs elsewhere", () => {
    expect(joinHyphenated("inter", "esting", vocab)).toBe("interesting")
  })

  it("joins losslessly when a suffix-stripped base occurs elsewhere", () => {
    // "understand" is not in the document, but "understanding" is.
    expect(joinHyphenated("under", "standing", vocab)).toBe("understanding")
    expect(joinHyphenated("bright", "ness", buildVocabulary(["bright"]))).toBe("brightness")
  })

  it("joins losslessly when a prefix-stripped base occurs elsewhere", () => {
    expect(joinHyphenated("rebu", "ilding", buildVocabulary(["building"]))).toBe("rebuilding")
  })

  it("keeps the hyphen for an unattested compound", () => {
    expect(joinHyphenated("well", "known", vocab)).toBe("well-known")
  })

  it("keeps the hyphen when either half is two characters or shorter", () => {
    expect(joinHyphenated("X", "ray", buildVocabulary(["xray"]))).toBe("X-ray")
    expect(joinHyphenated("shoot", "em", buildVocabulary(["shootem"]))).toBe("shoot-em")
  })
})

describe("dehyphenate", () => {
  it("heals a wrapped word using the document as its dictionary", () => {
    const doc = ["He found it inter- esting.", "An interesting day."]
    expect(dehyphenateAll(doc)[0]).toBe("He found it interesting.")
  })

  it("preserves a real compound the document never spells solid", () => {
    const doc = ["A well- known trick.", "It was well known to be a trick."]
    // "wellknown" appears nowhere, so the hyphen survives — but the wrap space
    // still goes away.
    expect(dehyphenateAll(doc)[0]).toBe("A well-known trick.")
  })

  it("never touches a dash used as punctuation", () => {
    const vocab = buildVocabulary(["waitno wait no"])
    expect(dehyphenate("wait - no", vocab)).toBe("wait - no")
    expect(dehyphenate("wait — no", vocab)).toBe("wait — no")
  })

  it("does not join when the continuation is capitalized (a new sentence)", () => {
    const vocab = buildVocabulary(["counterstrike"])
    expect(dehyphenate("Counter- Strike", vocab)).toBe("Counter- Strike")
  })

  it("handles the U+2010 hyphen as well as ASCII", () => {
    const doc = ["a real inter‐ esting case", "interesting"]
    expect(dehyphenateAll(doc)[0]).toBe("a real interesting case")
  })

  it("leaves hyphen-free text byte-identical", () => {
    const text = "The drone hovered at the edge of the clearing."
    expect(dehyphenateAll([text])[0]).toBe(text)
  })
})

describe("stripRunningHeadersFooters", () => {
  // Distinct body text per page. Deliberately letters, not numbers: digit
  // folding is aggressive by design, so `body 1` / `body 2` would (correctly)
  // look like one repeated line.
  const WORDS = "alpha bravo charlie delta echo foxtrot golf hotel".split(" ")
  const body = (i: number) => `The ${WORDS[i % WORDS.length]} stirred, then went still.`

  /** n pages, each: running head, one unique body line, page number. */
  function book(n: number, head = "Chapter 12 — The Drone") {
    return Array.from({ length: n }, (_, i) => [
      { text: head },
      { text: body(i) },
      { text: `${i + 1}` },
    ])
  }

  it("drops a running header and the page numbers", () => {
    const out = stripRunningHeadersFooters(book(6))
    expect(out.map((p) => p.map((l) => l.text))).toEqual(
      Array.from({ length: 6 }, (_, i) => [body(i)]),
    )
  })

  it("matches running heads whose only difference is a number", () => {
    const pages = Array.from({ length: 5 }, (_, i) => [
      { text: `Page ${i + 1} of 5` },
      { text: body(i) },
    ])
    expect(stripRunningHeadersFooters(pages).map((p) => p.map((l) => l.text))).toEqual(
      Array.from({ length: 5 }, (_, i) => [body(i)]),
    )
  })

  it("keeps a line that appears on only 2 of 40 pages", () => {
    const pages = Array.from({ length: 40 }, (_, i) => [
      { text: i < 2 ? "A rare repeated opening." : `A ${WORDS[i % 8]} opening.` },
      { text: body(i) },
    ])
    const out = stripRunningHeadersFooters(pages)
    expect(out[0][0].text).toBe("A rare repeated opening.")
    expect(out.every((p) => p.length === 2)).toBe(true)
  })

  it("never drops a repeated line that sits mid-page", () => {
    const pages = Array.from({ length: 6 }, (_, i) => [
      { text: `Top ${WORDS[i]}` },
      { text: `Second ${WORDS[i]}` },
      { text: "He said nothing." }, // middle: repeated but positionally safe
      { text: `Fourth ${WORDS[i]}` },
      { text: `Last ${WORDS[i]}` },
    ])
    const out = stripRunningHeadersFooters(pages)
    expect(out.every((p) => p.length === 5)).toBe(true)
  })

  it("leaves a two-page chapter's repeated head alone (min 3 pages)", () => {
    const out = stripRunningHeadersFooters(book(2))
    expect(out[0].map((l) => l.text)).toEqual(["Chapter 12 — The Drone", body(0)])
  })

  it("still drops a standalone page number on a single page", () => {
    expect(
      stripRunningHeadersFooters([[{ text: "Some prose." }, { text: "17" }]])[0],
    ).toEqual([{ text: "Some prose." }])
  })

  it("keeps a bare number that is not at a page edge", () => {
    const page = [{ text: "a" }, { text: "b" }, { text: "42" }, { text: "c" }, { text: "d" }]
    expect(stripRunningHeadersFooters([page])[0]).toHaveLength(5)
  })

  it("folds digits and case when comparing candidates", () => {
    expect(normalizeHeaderCandidate("  Chapter  12 ")).toBe("chapter #")
    expect(normalizeHeaderCandidate("CHAPTER 7")).toBe("chapter #")
  })

  it("preserves the caller's line geometry", () => {
    const pages = [
      [
        { text: "1", y: 10, height: 12 },
        { text: "keep", y: 50, height: 12 },
      ],
    ]
    expect(stripRunningHeadersFooters(pages)[0]).toEqual([
      { text: "keep", y: 50, height: 12 },
    ])
  })
})

describe("isSceneBreak", () => {
  it("recognizes the usual dividers", () => {
    for (const d of ["* * *", "***", "◇◇◇", "~~~", "###", "---", "◆ ◆ ◆", "※", "⁂"]) {
      expect(isSceneBreak(d), d).toBe(true)
    }
  })

  it("rejects prose, dialogue and punctuation runs", () => {
    for (const t of [
      '"..."',
      "...",
      "…",
      "?!",
      "He said nothing.",
      "* Not a break, a footnote",
      "*emphasis*",
      "[Common]",
      "— he began",
      "-",
      "12",
    ]) {
      expect(isSceneBreak(t), t).toBe(false)
    }
  })

  it("rejects a divider longer than ten characters", () => {
    expect(isSceneBreak("~~~~~~~~~~")).toBe(true)
    expect(isSceneBreak("~~~~~~~~~~~")).toBe(false)
  })

  it("rejects a mixed run", () => {
    expect(isSceneBreak("*-*")).toBe(false)
  })
})
