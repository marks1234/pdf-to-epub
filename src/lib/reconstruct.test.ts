import { describe, it, expect } from "vitest"

import {
  blocksToHtml,
  markSceneBreaks,
  mergePageBlocks,
  reconstructChapterBlocks,
  reconstructLines,
  type Block,
  type Glyph,
} from "./reconstruct"

describe("blocksToHtml stat-sheet handling", () => {
  it("boxes a run of stat-like blocks into a stat-sheet panel", () => {
    const blocks: Block[] = [
      { type: "p", text: "Crafted Grade Mythic-Grade" },
      { type: "p", text: "Build Condition 100%" },
    ]
    const html = blocksToHtml(blocks)
    expect(html.startsWith('<div class="stat-sheet">')).toBe(true)
    expect(html.endsWith("</div>")).toBe(true)
    expect(html).toContain('<div class="stat-line">Crafted Grade ')
    expect(html).toContain('class="rarity-mythic"') // Mythic-Grade → tier color
    expect(html).toContain('class="pct"') // 100%
  })

  it("de-glues run-on stat fields that were merged without spaces", () => {
    // The exact merge artifact seen in the wild (page-16).
    const blocks: Block[] = [
      {
        type: "p",
        text: "Capacitor: [Active: 6] [Missing: 1]Internal Damage: [Repairing: 16.2%]External Damage: [Restructuring: 0.8%]",
      },
    ]
    const html = blocksToHtml(blocks)
    // Each glued field becomes its own stat-line.
    expect(html).toContain('<div class="stat-line">Capacitor:')
    expect(html).toContain('<div class="stat-line">Internal Damage:')
    expect(html).toContain('<div class="stat-line">External Damage:')
    expect(html).toContain('class="kw-good">Active') // status keyword
    expect(html).toContain('class="kw-bad">Missing')
    expect(html).toContain('class="pct"') // 16.2% / 0.8%
  })

  it("leaves ordinary prose as a plain paragraph but still colors percentages", () => {
    const blocks: Block[] = [
      { type: "p", text: "He was about 90% sure the [thing] would work." },
    ]
    const html = blocksToHtml(blocks)
    expect(html.startsWith("<p>")).toBe(true)
    expect(html).not.toContain("stat-sheet")
    expect(html).not.toContain("kw-") // no keyword coloring in prose
    expect(html).toContain('class="pct"') // but 90% is colored
    expect(html).toContain("[thing]") // bracket left alone
  })

  it("keeps a lone weak bullet as a light list, not a full panel", () => {
    const blocks: Block[] = [{ type: "li", text: "just one bullet point" }]
    const html = blocksToHtml(blocks)
    expect(html).toBe('<ul class="stat-block"><li>just one bullet point</li></ul>')
  })

  it("breaks a run-on ability list into one line per labeled entry", () => {
    // The exact bug: several "Name: description" entries collapsed into one block.
    const blocks: Block[] = [
      {
        type: "p",
        text:
          "Subsume: Allows the Soul Stealer to permanently acquire the unique ability of a defeated entity, improving attributes and innate abilities. " +
          "Capture: Acquired essence can be efficiently repurposed and stored by the Soul Stealer for later use. " +
          "Phylactery: Allows the Soul Stealer to create a customised physical vessel to hold captured essences. " +
          "Reactor: Grants the Soul Stealer a near endless reserve of unrefined essence, partitioned for efficiency.",
      },
    ]
    const html = blocksToHtml(blocks)
    expect(html).toContain('<div class="stat-line">Subsume:')
    expect(html).toContain('<div class="stat-line">Capture:')
    expect(html).toContain('<div class="stat-line">Phylactery:')
    expect(html).toContain('<div class="stat-line">Reactor:')
  })

  it("renders a scene break as an <hr> and breaks the surrounding stat run", () => {
    const blocks: Block[] = [
      { type: "li", text: "[Common] Switcher Core obtained." },
      { type: "hr", text: "* * *" },
      { type: "li", text: "[Rare] Blade obtained." },
    ]
    const html = blocksToHtml(blocks)
    expect(html.split("\n")).toEqual([
      '<ul class="stat-block"><li><span class="rarity-common">[Common]</span> Switcher Core obtained.</li></ul>',
      '<hr class="scene-break" />',
      '<ul class="stat-block"><li><span class="rarity-rare">[Rare]</span> Blade obtained.</li></ul>',
    ])
  })

  it("does NOT split ordinary prose that merely contains a colon", () => {
    const blocks: Block[] = [
      {
        type: "p",
        text:
          "He had one rule above all others: never trust a Switcher. " +
          "It was advice his mother gave him long ago, and it had kept him alive more than once.",
      },
    ]
    const html = blocksToHtml(blocks)
    expect(html.startsWith("<p>")).toBe(true)
    expect(html).not.toContain("stat-line")
  })
})

describe("markSceneBreaks", () => {
  it("tags divider paragraphs and leaves everything else alone", () => {
    expect(
      markSceneBreaks([
        { type: "p", text: "She left." },
        { type: "p", text: "* * *" },
        { type: "p", text: '"..."' },
        { type: "li", text: "***" }, // a list item is never re-typed
      ]),
    ).toEqual([
      { type: "p", text: "She left." },
      { type: "hr", text: "* * *" },
      { type: "p", text: '"..."' },
      { type: "li", text: "***" },
    ])
  })
})

describe("mergePageBlocks", () => {
  it("stitches a paragraph split across a page boundary", () => {
    expect(
      mergePageBlocks([
        [{ type: "p", text: "The drone hovered at the edge of the" }],
        [{ type: "p", text: "clearing, sensors sweeping the treeline." }],
      ]),
    ).toEqual([
      {
        type: "p",
        text: "The drone hovered at the edge of the clearing, sensors sweeping the treeline.",
      },
    ])
  })

  it("does not stitch when the previous page ended a sentence", () => {
    const pages: Block[][] = [
      [{ type: "p", text: "The drone powered down." }],
      [{ type: "p", text: "morning came slowly." }],
    ]
    expect(mergePageBlocks(pages)).toHaveLength(2)
  })

  it("does not stitch when the next page starts a new sentence", () => {
    const pages: Block[][] = [
      [{ type: "p", text: "He counted three exits and" }],
      [{ type: "p", text: "Morning came slowly." }],
    ]
    expect(mergePageBlocks(pages)).toHaveLength(2)
  })

  it("never stitches across a list item or a scene break", () => {
    const pages: Block[][] = [
      [{ type: "li", text: "0.12 Strength has been subsumed" }],
      [{ type: "p", text: "and stored" }],
      [{ type: "hr", text: "***" }],
      [{ type: "p", text: "she walked on" }],
    ]
    expect(mergePageBlocks(pages)).toHaveLength(4)
  })

  it("keeps every later block of the joined page", () => {
    const merged = mergePageBlocks([
      [{ type: "p", text: "the sentence runs on" }],
      [
        { type: "p", text: "past the page break." },
        { type: "p", text: "A second paragraph." },
      ],
    ])
    expect(merged).toEqual([
      { type: "p", text: "the sentence runs on past the page break." },
      { type: "p", text: "A second paragraph." },
    ])
  })

  it("tolerates empty pages", () => {
    expect(mergePageBlocks([])).toEqual([])
    expect(
      mergePageBlocks([
        [{ type: "p", text: "the sentence runs on" }],
        [],
        [{ type: "p", text: "past the break." }],
      ]),
    ).toEqual([{ type: "p", text: "the sentence runs on past the break." }])
  })
})

// ── Glyph-level helpers for the geometry tests ───────────────────────────────

/** One text fragment at (x, y) with the given advance width. */
function glyph(
  str: string,
  x: number,
  y: number,
  width = str.length * 5,
  height = 10,
): Glyph {
  return { str, width, height, transform: [1, 0, 0, 1, x, y] }
}

/**
 * One page: each string becomes its own line AND its own block — the lines are
 * spaced well past the new-paragraph threshold, so these tests exercise page
 * stitching rather than intra-page wrapping.
 */
function page(texts: string[], height = 10): Glyph[] {
  return texts.map((t, i) => glyph(t, 50, 1000 - i * height * 3, undefined, height))
}

describe("reconstructLines", () => {
  it("groups fragments into lines and spaces them at real gaps", () => {
    const items = [
      glyph("Hello", 50, 700, 25),
      glyph("world", 80, 700, 25), // 5pt gap → a space
      glyph("!", 105, 700, 3), // flush → no space
      glyph("Next line", 50, 680, 45),
    ]
    expect(reconstructLines(items)).toEqual([
      { y: 700, height: 10, text: "Hello world!" },
      { y: 680, height: 10, text: "Next line" },
    ])
  })

  it("matches the original O(n²) line scan exactly", () => {
    // Reference implementation: the pre-optimization `lines.find(...)` scan.
    function reference(items: Glyph[]): { y: number; text: string }[] {
      const lines: { y: number; height: number; items: Glyph[] }[] = []
      for (const it of items.filter((g) => g.str.trim() !== "" || g.width > 0)) {
        const y = it.transform[5]
        const h = it.height || 10
        const line = lines.find(
          (l) => Math.abs(l.y - y) <= Math.max(l.height, h) * 0.5,
        )
        if (line) {
          line.items.push(it)
          line.height = Math.max(line.height, h)
        } else {
          lines.push({ y, height: h, items: [it] })
        }
      }
      lines.sort((a, b) => b.y - a.y)
      return lines.map((l) => ({
        y: l.y,
        text: [...l.items]
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((g) => g.str)
          .join("|"),
      }))
    }

    // Pseudo-random but deterministic: jittered baselines (big enough that some
    // fragments legitimately fail to join their row's first line), mixed heights,
    // and fragments emitted out of reading order — pdf.js does that constantly.
    // Each fragment gets a unique, widely spaced x so line text always separates
    // fragments with a space, making the two representations comparable.
    let seed = 12345
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const items: Glyph[] = []
    for (let i = 0; i < 400; i++) {
      const row = Math.floor(rand() * 40)
      const height = 8 + Math.floor(rand() * 6)
      items.push(glyph(`f${i}`, i * 40, 1000 - row * 14 + (rand() - 0.5) * 6, 8, height))
    }

    const mine = reconstructLines(items).map((l) => ({
      y: l.y,
      text: l.text.replace(/ /g, "|"),
    }))
    expect(mine).toEqual(reference(items))
  })

  it("stays fast on a text-dense page", () => {
    const items: Glyph[] = []
    for (let row = 0; row < 60; row++) {
      for (let col = 0; col < 120; col++) {
        items.push(glyph("x", col * 6, 1000 - row * 14, 5))
      }
    }
    const started = Date.now()
    expect(reconstructLines(items)).toHaveLength(60)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe("reconstructChapterBlocks", () => {
  it("strips running heads, then heals the paragraph they interrupted", () => {
    const pages = [
      page(["Chapter 12", "The drone hovered at the edge of the", "1"]),
      page(["Chapter 12", "clearing, sensors sweeping the treeline.", "2"]),
      page(["Chapter 12", "Nothing stirred.", "* * *", "He waited.", "3"]),
    ]
    expect(reconstructChapterBlocks(pages)).toEqual([
      {
        type: "p",
        text: "The drone hovered at the edge of the clearing, sensors sweeping the treeline.",
      },
      { type: "p", text: "Nothing stirred." },
      { type: "hr", text: "* * *" },
      { type: "p", text: "He waited." },
    ])
  })

  it("returns nothing for a page with no text", () => {
    expect(reconstructChapterBlocks([[], []])).toEqual([])
  })
})
