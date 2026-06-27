import { describe, it, expect } from "vitest"

import {
  DEFAULT_STYLE_CONFIG,
  cloneConfig,
  createStyler,
  cssFromConfig,
  percentColor,
  textStyleCss,
  type StyleConfig,
} from "./styles"

const styler = createStyler(DEFAULT_STYLE_CONFIG)

describe("createStyler.styleStat", () => {
  it("colors bracketed rarity tags", () => {
    expect(styler.styleStat("[Legendary] blade")).toContain(
      '<span class="rarity-legendary">[Legendary]</span>',
    )
  })

  it("colors status keywords and grade words", () => {
    expect(styler.styleStat("[Suitability: Excellent]")).toContain('class="kw-good"')
    // Bare build-quality / grade words are matched by keyword groups.
    expect(styler.styleStat("Build Quality Flawless")).toContain('class="kw-grade-pink"')
    expect(styler.styleStat("Mythic-Grade")).toContain('class="kw-grade-gold"')
  })

  it("colors a standalone percentage and a close pair (second = max)", () => {
    const out = styler.styleStat("Reactor [4.9%] Whips [0.6% of 10%]")
    // three pct spans, last one (10%) is the max → high color.
    expect((out.match(/class="pct"/g) || []).length).toBe(3)
    expect(out).toContain(percentColor(1, DEFAULT_STYLE_CONFIG.percent)) // the max
  })

  it("escapes HTML and never double-wraps", () => {
    const out = styler.styleStat("[Rare] <b> & 50%")
    expect(out).toContain("&lt;b&gt;")
    expect(out).toContain("&amp;")
    // every <span> is balanced
    expect((out.match(/<span/g) || []).length).toBe((out.match(/<\/span>/g) || []).length)
  })
})

describe("percentColor", () => {
  it("interpolates low→mid→high", () => {
    const p = { enabled: true, low: "#ff0000", mid: "#00ff00", high: "#0000ff", pairMax: true, bold: true }
    expect(percentColor(0, p)).toBe("rgb(255,0,0)")
    expect(percentColor(0.5, p)).toBe("rgb(0,255,0)")
    expect(percentColor(1, p)).toBe("rgb(0,0,255)")
  })
})

describe("cssFromConfig", () => {
  it("emits a rule for every rarity tier and keyword group", () => {
    const css = cssFromConfig(DEFAULT_STYLE_CONFIG)
    for (const t of DEFAULT_STYLE_CONFIG.rarities) expect(css).toContain(`.rarity-${t.key}{`)
    for (const g of DEFAULT_STYLE_CONFIG.keywords) expect(css).toContain(`.kw-${g.key}{`)
  })

  it("reflects edited colors", () => {
    const cfg: StyleConfig = cloneConfig(DEFAULT_STYLE_CONFIG)
    cfg.rarities[1].style.color = "#123456"
    expect(cssFromConfig(cfg)).toContain(".rarity-common{color:#123456;")
  })
})

describe("textStyleCss gradient fallback", () => {
  it("puts a solid color before the gradient and never color:transparent", () => {
    const css = textStyleCss({ color: "#caa53d", gradient: ["#fff", "#000"], glow: "0 0 3px red", bold: true })
    expect(css.indexOf("color:")).toBeLessThan(css.indexOf("background:"))
    expect(css).toContain("-webkit-text-fill-color:transparent")
    expect(css).not.toMatch(/(^|;)color:transparent/)
  })
})

describe("config integrity", () => {
  it("never maps the same rarity word to two tiers", () => {
    const seen = new Set<string>()
    for (const t of DEFAULT_STYLE_CONFIG.rarities)
      for (const w of t.words) {
        expect(seen.has(w), `duplicate rarity word "${w}"`).toBe(false)
        seen.add(w)
      }
  })
})
