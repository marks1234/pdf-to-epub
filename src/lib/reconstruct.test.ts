import { describe, it, expect } from "vitest"

import { blocksToHtml, type Block } from "./reconstruct"

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
    expect(html).toContain('class="kw-grade-gold"') // Mythic-Grade keyword group
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
})
