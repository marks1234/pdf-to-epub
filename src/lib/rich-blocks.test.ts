import { describe, it, expect } from "vitest"

import { blocksToHtml, type Block } from "./reconstruct"
import { cssFromConfig, DEFAULT_STYLE_CONFIG } from "./styles"

/**
 * Rich blocks (optional `runs` / `align` / `role`) come from HTML sources such
 * as the Patreon extension. PDF blocks never carry them; their output is
 * pinned by regression.test.ts.
 */
describe("blocksToHtml — rich blocks", () => {
  it("renders a bold-italic System line as nested strong/em", () => {
    const blocks: Block[] = [
      {
        type: "p",
        text: "Lord of Sundered Shadows (Expert 3)",
        runs: [{ text: "Lord of Sundered Shadows (Expert 3)", marks: ["b", "i"] }],
      },
    ]
    expect(blocksToHtml(blocks)).toBe("<p><strong><em>Lord of Sundered Shadows (Expert 3)</em></strong></p>")
  })

  it("renders mixed inline formatting and line breaks in one paragraph", () => {
    const blocks: Block[] = [
      {
        type: "p",
        text: "Plain bold italic under strike next",
        runs: [
          { text: "Plain " },
          { text: "bold", marks: ["b"] },
          { text: " " },
          { text: "italic", marks: ["i"] },
          { text: " " },
          { text: "under", marks: ["u"] },
          { text: " " },
          { text: "strike", marks: ["s"] },
          { text: "", br: true },
          { text: "next" },
        ],
      },
    ]
    expect(blocksToHtml(blocks)).toBe(
      "<p>Plain <strong>bold</strong> <em>italic</em> <u>under</u> <s>strike</s><br />next</p>",
    )
  })

  it("orders marks canonically however they were listed", () => {
    const html = blocksToHtml([{ type: "p", text: "x", runs: [{ text: "x", marks: ["s", "i", "u", "b"] }] }])
    expect(html).toBe("<p><strong><em><u><s>x</s></u></em></strong></p>")
  })

  it("colors a percentage inside <em> in prose", () => {
    const html = blocksToHtml([
      { type: "p", text: "It hit for 45% damage.", runs: [{ text: "It hit for " }, { text: "45%", marks: ["i"] }, { text: " damage." }] },
    ])
    expect(html).toMatch(/^<p>It hit for <em><span class="pct" style="[^"]*">45%<\/span><\/em> damage\.<\/p>$/)
  })

  it("colors a rarity tag inside <em> within a stat sheet", () => {
    const blocks: Block[] = [
      {
        type: "p",
        text: "Weapon: [Legendary] [Sword]",
        runs: [{ text: "Weapon: " }, { text: "[Legendary]", marks: ["i"] }, { text: " [Sword]" }],
      },
      { type: "p", text: "Armor: [Rare] [Plate]" },
    ]
    const html = blocksToHtml(blocks)
    expect(html).toContain('<div class="stat-sheet">')
    expect(html).toContain('<em><span class="rarity-legendary">[Legendary]</span></em>')
    expect(html).toContain('<span class="rarity-rare">[Rare]</span>')
  })

  it("never colors across a tag boundary", () => {
    // "[Legen" + "dary]" split by formatting must not be matched as one tag.
    const blocks: Block[] = [
      {
        type: "p",
        text: "Weapon: [Legendary] [Sword]",
        runs: [{ text: "Weapon: [Legen" }, { text: "dary]", marks: ["b"] }, { text: " [Sword]" }],
      },
      { type: "p", text: "Armor: [Rare] [Plate]" },
    ]
    expect(blocksToHtml(blocks)).not.toContain("rarity-legendary")
  })

  it("maps alignment to a class, and headings/quotes to their elements", () => {
    const html = blocksToHtml([
      { type: "p", text: "Centered", align: "center" },
      { type: "p", text: "Right", align: "right", runs: [{ text: "Right", marks: ["b"] }] },
      { type: "p", text: "Heading", role: "h2" },
      { type: "p", text: "Quoted one", role: "blockquote" },
      { type: "p", text: "Quoted two", role: "blockquote", align: "center" },
    ])
    expect(html.split("\n")).toEqual([
      '<p class="align-center">Centered</p>',
      '<p class="align-right"><strong>Right</strong></p>',
      "<h2>Heading</h2>",
      '<blockquote><p>Quoted one</p><p class="align-center">Quoted two</p></blockquote>',
    ])
  })

  it("ships CSS for the alignment classes", () => {
    const css = cssFromConfig(DEFAULT_STYLE_CONFIG)
    expect(css).toContain(".align-center{text-align:center;")
    expect(css).toContain(".align-right{text-align:right;")
  })

  it("escapes run text and ignores unknown alignment/role values", () => {
    const evil = {
      type: "p",
      text: "<script>alert(1)</script>",
      runs: [{ text: '<script>alert(1)</script>"onclick=' }],
      align: 'center" onclick="x' as unknown as "center",
      role: "script" as unknown as "h1",
    } satisfies Block
    const html = blocksToHtml([evil])
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;\"onclick=</p>")
  })

  it("leaves plain (PDF-style) blocks byte-identical", () => {
    const plain: Block[] = [
      { type: "p", text: "Ordinary prose at 50%." },
      { type: "hr", text: "* * *" },
      { type: "li", text: "Strength: 10" },
    ]
    // Same blocks with explicit undefined rich fields render the same.
    const withUndefined = plain.map((b) => ({ ...b, runs: undefined, align: undefined, role: undefined }))
    expect(blocksToHtml(withUndefined)).toBe(blocksToHtml(plain))
  })
})
