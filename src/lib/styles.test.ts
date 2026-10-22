import { describe, it, expect } from "vitest"

import {
  DEFAULT_STYLE_CONFIG,
  FALLBACK_COLOR,
  cloneConfig,
  createStyler,
  cssFromConfig,
  glowFor,
  normalizeHex,
  percentColor,
  safeColor,
  safePanelColor,
  safeShadow,
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
  })

  it("matches rarity tiers bracketed, bare-with-suffix, and via word lists", () => {
    expect(styler.styleStat("[Mythic] guild")).toContain('class="rarity-mythic"')
    // "<tier>-grade" forms map to the tier color (BUG 1: "Mythic-grade").
    expect(styler.styleStat("Crafted Grade Mythic-grade")).toContain(
      '<span class="rarity-mythic">Mythic-grade</span>',
    )
    expect(styler.styleStat("a Legendary-grade item")).toContain('class="rarity-legendary"')
    // Bare "Mythical" is a curated grade keyword (mythic-purple).
    expect(styler.styleStat("Mythical sword")).toContain('class="kw-grade-gold"')
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

describe("normalizeHex", () => {
  it("accepts #rrggbb and expands #rgb", () => {
    expect(normalizeHex("#caa53d")).toBe("#caa53d")
    expect(normalizeHex("#CAA53D")).toBe("#caa53d")
    expect(normalizeHex("  #abc  ")).toBe("#aabbcc")
    expect(normalizeHex("#F00")).toBe("#ff0000")
  })

  it("rejects everything that isn't a hex color", () => {
    for (const bad of [
      "red",
      "rebeccapurple",
      "#abcd", // 4-char: used to parse as garbage
      "#abcde", // 5-char
      "#abcdefg",
      "caa53d", // missing #
      "rgb(1,2,3)",
      "red;} body{display:none",
      "#12345;",
      "",
      "   ",
      null,
      undefined,
      42,
      { color: "#fff" },
      ["#fff"],
    ])
      expect(normalizeHex(bad), String(bad)).toBeNull()
  })

  it("safeColor substitutes the fallback instead of propagating junk", () => {
    expect(safeColor("red")).toBe(FALLBACK_COLOR)
    expect(safeColor("#abc")).toBe("#aabbcc")
    expect(safeColor("nope", "#123456")).toBe("#123456")
  })
})

describe("safePanelColor", () => {
  it("allows hex, the safe keywords and rgb()/rgba()", () => {
    expect(safePanelColor("#abc", "#000000")).toBe("#aabbcc")
    // keyword spelling is preserved verbatim (byte-identical default CSS)
    expect(safePanelColor("currentColor", "#000000")).toBe("currentColor")
    expect(safePanelColor("transparent", "#000000")).toBe("transparent")
    expect(safePanelColor("rgba(128,128,128,0.08)", "#000000")).toBe("rgba(128,128,128,0.08)")
    expect(safePanelColor("rgb(1, 2, 3)", "#000000")).toBe("rgb(1, 2, 3)")
  })

  it("rejects injection attempts and anything else", () => {
    for (const bad of [
      "red;} body{display:none",
      "rgba(1,2,3,0.5);}html{color:red",
      "url(evil.png)",
      "linear-gradient(90deg,#fff,#000)",
      "expression(alert(1))",
      "#fff;",
      "/*",
      null,
      7,
    ])
      expect(safePanelColor(bad, "FALLBACK"), String(bad)).toBe("FALLBACK")
  })
})

describe("safeShadow", () => {
  it("keeps real text-shadow values", () => {
    expect(safeShadow("0 0 3px rgba(212,175,55,.55)")).toBe("0 0 3px rgba(212,175,55,.55)")
    expect(safeShadow("0 0 8px rgba(255,255,255,.7),0 0 4px rgba(255,90,160,.6)")).toBe(
      "0 0 8px rgba(255,255,255,.7),0 0 4px rgba(255,90,160,.6)",
    )
  })

  it("drops anything that could close the declaration", () => {
    for (const bad of ["0 0 3px red;} body{display:none", "red;color:blue", "a/*b*/", "x{}", 1, null, ""])
      expect(safeShadow(bad), String(bad)).toBe("")
  })
})

describe("percentColor", () => {
  it("interpolates low→mid→high", () => {
    const p = { enabled: true, low: "#ff0000", mid: "#00ff00", high: "#0000ff", pairMax: true, bold: true }
    expect(percentColor(0, p)).toBe("rgb(255,0,0)")
    expect(percentColor(0.5, p)).toBe("rgb(0,255,0)")
    expect(percentColor(1, p)).toBe("rgb(0,0,255)")
  })

  it("never emits rgb(NaN,NaN,NaN) for invalid stops or ratios", () => {
    const junk = { enabled: true, low: "red", mid: "#abcd", high: "", pairMax: true, bold: true }
    for (const r of [0, 0.25, 0.5, 0.75, 1, NaN, Infinity, -1, 2]) {
      const out = percentColor(r, junk)
      expect(out, `ratio ${r}`).toMatch(/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/)
      expect(out).not.toContain("NaN")
    }
    expect(percentColor(0, junk)).toBe("rgb(128,128,128)")
  })

  it("cannot smuggle CSS through a stop", () => {
    const evil = {
      enabled: true,
      low: "red;} body{display:none",
      mid: "#00ff00",
      high: "#0000ff",
      pairMax: true,
      bold: true,
    }
    expect(percentColor(0, evil)).toBe("rgb(128,128,128)")
    expect(percentColor(0.2, evil)).not.toContain("}")
  })
})

describe("glowFor", () => {
  it("derives a glow from a valid color and falls back otherwise", () => {
    expect(glowFor("#ff0000")).toBe("0 0 4px rgba(255,0,0,0.6)")
    expect(glowFor("#f00")).toBe("0 0 4px rgba(255,0,0,0.6)")
    // 4-char hex used to slip through the old /^#[0-9a-f]{3,6}$/ guard.
    expect(glowFor("#abcd")).toBe("0 0 4px rgba(120,120,120,0.5)")
    expect(glowFor("red")).toBe("0 0 4px rgba(120,120,120,0.5)")
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

  it("emits the exact built-in stylesheet lines (golden — the EPUB must not drift)", () => {
    const css = cssFromConfig(DEFAULT_STYLE_CONFIG)
    expect(css).toContain(
      ".stat-sheet{margin:1em 0;padding:0.55em 0.85em;border:1px solid currentColor;" +
        "border-radius:8px;background:rgba(128,128,128,0.08);font-size:0.95em;line-height:1.5;}",
    )
    expect(css).toContain(
      ".rarity-legendary{color:#caa53d;text-shadow:0 0 3px rgba(212,175,55,.55);" +
        "letter-spacing:0.02em;font-weight:700;}",
    )
    expect(css).toContain(".kw-good{color:#2f9e44;font-weight:600;}")
  })

  it("never contains a linear-gradient (it kills Kindle Enhanced Typesetting)", () => {
    const cfg = cloneConfig(DEFAULT_STYLE_CONFIG)
    // Even if a stale saved config carries the legacy gradient stops:
    ;(cfg.rarities[0].style as unknown as { gradient: string[] }).gradient = [
      "#ff0000",
      "#00ff00",
    ]
    const css = cssFromConfig(cfg)
    expect(css).not.toContain("gradient")
    expect(css).not.toContain("background-image")
  })
})

describe("cssFromConfig resists CSS injection", () => {
  const evil = (patch: (c: StyleConfig) => void): string => {
    const cfg = cloneConfig(DEFAULT_STYLE_CONFIG)
    patch(cfg)
    return cssFromConfig(cfg)
  }

  it("sanitizes the stat-sheet background and border", () => {
    const css = evil((c) => {
      c.statSheet.background = "red;} body{display:none"
      c.statSheet.border = "blue;}html{visibility:hidden"
    })
    expect(css).not.toContain("display:none")
    expect(css).not.toContain("visibility:hidden")
    expect(css).toContain("border:1px solid currentColor")
    expect(css).toContain("background:rgba(128,128,128,0.08)")
  })

  it("sanitizes tier colors, glows and class keys", () => {
    const css = evil((c) => {
      c.rarities[0].style.color = "red;} body{display:none"
      c.rarities[1].style.glow = "0 0 1px red;} body{content:'x'"
      c.keywords[0].key = "good{}/*evil*/"
    })
    expect(css).not.toContain("display:none")
    expect(css).not.toContain("/*")
    expect(css).toContain(`.rarity-broken{color:${FALLBACK_COLOR};`)
    expect(css).toContain(".kw-goodevil{")
    // Braces only ever come in matched selector/rule pairs.
    expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length)
  })

  it("keeps emitted class names in sync with the sanitized selectors", () => {
    const cfg = cloneConfig(DEFAULT_STYLE_CONFIG)
    cfg.rarities[0].key = "bro ken!"
    const s = createStyler(cfg)
    expect(s.styleStat("[Broken] sword")).toContain('class="rarity-broken"')
    expect(s.css).toContain(".rarity-broken{")
  })
})

describe("textStyleCss is Kindle-safe", () => {
  it("uses a solid visible color and never the invisible-text gradient technique", () => {
    const css = textStyleCss({ color: "#caa53d", glow: "0 0 4px rgba(1,2,3,.6)", bold: true })
    expect(css).toContain("color:#caa53d")
    expect(css).toContain("text-shadow:")
    expect(css).toContain("font-weight:700")
    // none of the Kindle-invisible techniques:
    expect(css).not.toContain("background")
    expect(css).not.toContain("-webkit-text-fill-color")
    expect(css).not.toMatch(/color:\s*transparent/)
  })

  it("every default tier (incl. legendary+) emits a real solid color", () => {
    const css = cssFromConfig(DEFAULT_STYLE_CONFIG)
    expect(css).not.toContain("background-clip")
    expect(css).not.toContain("transparent")
    for (const t of DEFAULT_STYLE_CONFIG.rarities)
      expect(css).toMatch(new RegExp(`\\.rarity-${t.key}\\{color:#`))
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
