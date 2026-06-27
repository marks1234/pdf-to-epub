import { describe, it, expect } from "vitest"

import {
  assembleBlocks,
  blocksToHtml,
  type Block,
  type ReconstructedLine,
} from "./pdf-to-epub"

/**
 * Build single-spaced lines from top to bottom (PDF Y grows upward, so each
 * successive line gets a *smaller* y). One unit of leading per line keeps the
 * vertical gap well under the "new paragraph" threshold, mimicking the tightly
 * packed stat blocks that used to collapse into one run-on paragraph.
 */
function lines(texts: string[], height = 10): ReconstructedLine[] {
  return texts.map((text, i) => ({ y: 1000 - i * height, height, text }))
}

describe("assembleBlocks", () => {
  it("keeps each bullet and section label on its own line (Jackal/Drone stat block)", () => {
    // The exact content from the reported bug: the EPUB rendered all of this as
    // a single run-on paragraph.
    const blocks = assembleBlocks(
      lines([
        "• [Common] Switcher has been killed.",
        "• Countermeasure Progress: 6%",
        "Subsume Results",
        "• 0.12 Strength has been subsumed.",
        "• 0.09 Endurance has been subsumed.",
        "Material Results",
        "• [Common] Switcher Core has been added to Arsenal.",
        "• [Common] Switcher Sinew has been added to Arsenal.",
      ]),
    )

    expect(blocks).toEqual([
      { type: "li", text: "[Common] Switcher has been killed." },
      { type: "li", text: "Countermeasure Progress: 6%" },
      { type: "p", text: "Subsume Results" },
      { type: "li", text: "0.12 Strength has been subsumed." },
      { type: "li", text: "0.09 Endurance has been subsumed." },
      { type: "p", text: "Material Results" },
      { type: "li", text: "[Common] Switcher Core has been added to Arsenal." },
      { type: "li", text: "[Common] Switcher Sinew has been added to Arsenal." },
    ])
  })

  it("still merges genuinely wrapped prose into one paragraph", () => {
    const blocks = assembleBlocks(
      lines([
        "The drone hovered at the edge of the clearing, its sensors",
        "sweeping the treeline for any sign of movement before it",
        "finally powered down for the night.",
      ]),
    )

    expect(blocks).toEqual([
      {
        type: "p",
        text:
          "The drone hovered at the edge of the clearing, its sensors " +
          "sweeping the treeline for any sign of movement before it " +
          "finally powered down for the night.",
      },
    ])
  })

  it("splits paragraphs on a large vertical gap", () => {
    const ls = lines(["First paragraph.", "Second paragraph."])
    // Push the second line far below the first (gap > height * 1.8).
    ls[1].y = ls[0].y - 50

    expect(assembleBlocks(ls)).toEqual([
      { type: "p", text: "First paragraph." },
      { type: "p", text: "Second paragraph." },
    ])
  })

  it("boxes a run of stat list items and colorizes their rarity tags", () => {
    const blocks: Block[] = [
      { type: "li", text: "[Common] Switcher Core has been added to Arsenal." },
      { type: "li", text: "[Legendary] Blade of Dawn obtained." },
    ]
    const html = blocksToHtml(blocks)
    expect(html).toBe(
      '<div class="stat-sheet">' +
        '<ul class="stat-block">' +
        '<li><span class="rarity-common">[Common]</span> Switcher Core has been added to Arsenal.</li>' +
        '<li><span class="rarity-legendary">[Legendary]</span> Blade of Dawn obtained.</li>' +
        "</ul>" +
        "</div>",
    )
  })

  it("never colorizes bracketed text in ordinary prose paragraphs", () => {
    const blocks: Block[] = [
      { type: "p", text: "The merchant called it [Legendary], but it was junk." },
    ]
    const html = blocksToHtml(blocks)
    expect(html).toBe(
      "<p>The merchant called it [Legendary], but it was junk.</p>",
    )
    expect(html).not.toContain("rarity-")
  })

  it("escapes HTML before colorizing so injected markup is the only tags", () => {
    const blocks: Block[] = [
      { type: "li", text: "[Rare] <script> & friends" },
    ]
    const html = blocksToHtml(blocks)
    expect(html).toBe(
      '<ul class="stat-block">' +
        '<li><span class="rarity-rare">[Rare]</span> &lt;script&gt; &amp; friends</li>' +
        "</ul>",
    )
  })

  it("merges a lowercase wrap of a long bullet back into that bullet", () => {
    const blocks = assembleBlocks(
      lines([
        "• [Common] Switcher Core has been added to the",
        "arsenal and is ready for deployment.",
      ]),
    )

    expect(blocks).toEqual([
      {
        type: "li",
        text:
          "[Common] Switcher Core has been added to the " +
          "arsenal and is ready for deployment.",
      },
    ])
  })
})
