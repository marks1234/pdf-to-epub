import { describe, it, expect } from "vitest"

import {
  DEFAULT_STYLE_CONFIG,
  EINK_MIN_CONTRAST,
  auditStyleConfig,
  borderOnlyPanel,
  checkColor,
  cloneConfig,
  contrastRatio,
  cssFromConfig,
  fixColorForEink,
  fixConfigForEink,
  hexToHsl,
  perceivedLuminance,
  relativeLuminance,
  styleConfigFromJson,
  styleConfigToJson,
  validateStyleConfig,
  validateStyleConfigDetailed,
  type StyleConfig,
} from "./styles"

/** A structurally valid config the tests can mangle field by field. */
function base(): StyleConfig {
  return cloneConfig(DEFAULT_STYLE_CONFIG)
}

describe("validateStyleConfig", () => {
  it("accepts the built-in config unchanged", () => {
    const out = validateStyleConfig(DEFAULT_STYLE_CONFIG)
    expect(out).not.toBeNull()
    expect(out).toEqual(DEFAULT_STYLE_CONFIG)
    // and the stylesheet it produces is identical
    expect(cssFromConfig(out!)).toBe(cssFromConfig(DEFAULT_STYLE_CONFIG))
  })

  it("rejects non-objects and missing sections", () => {
    for (const bad of [null, undefined, 42, "config", [], true])
      expect(validateStyleConfig(bad), String(bad)).toBeNull()

    for (const field of ["rarities", "keywords", "percent", "statSheet"] as const) {
      const cfg = base() as unknown as Record<string, unknown>
      delete cfg[field]
      expect(validateStyleConfig(cfg), field).toBeNull()
    }
  })

  it("reports a readable reason for each kind of failure", () => {
    const cases: [unknown, RegExp][] = [
      [null, /not a style config/i],
      [{ ...base(), rarities: "nope" }, /"rarities" must be an array/],
      [{ ...base(), keywords: [{}] }, /invalid "key"/],
      [
        { ...base(), rarities: [{ key: "a", label: "A", words: [], style: { color: "red" } }] },
        /invalid color "red"/,
      ],
      [
        { ...base(), rarities: [{ key: "a", label: "A", words: [1], style: { color: "#fff" } }] },
        /"words" must be an array of strings/,
      ],
      [
        { ...base(), percent: { ...base().percent, mid: "#abcd" } },
        /percent\.mid: invalid color/,
      ],
      [{ ...base(), percent: 5 }, /"percent" must be an object/],
      [{ ...base(), statSheet: "x" }, /"statSheet" must be an object/],
    ]
    for (const [value, re] of cases) {
      const r = validateStyleConfigDetailed(value)
      expect(r.ok, JSON.stringify(value).slice(0, 60)).toBe(false)
      if (!r.ok) expect(r.error).toMatch(re)
    }
  })

  it("rejects keys that would break out of a CSS selector", () => {
    const cfg = base()
    cfg.rarities[0].key = "broken{} body"
    expect(validateStyleConfig(cfg)).toBeNull()
    const dupes = base()
    dupes.rarities[1].key = dupes.rarities[0].key
    expect(validateStyleConfigDetailed(dupes)).toMatchObject({ ok: false })
  })

  it("normalizes colors and drops junk it can safely drop", () => {
    const cfg = base() as unknown as Record<string, unknown>
    const rarities = cloneConfig(DEFAULT_STYLE_CONFIG).rarities
    ;(rarities[0].style as unknown as Record<string, unknown>).color = "#ABC"
    // a legacy gradient array from an old saved profile
    ;(rarities[0].style as unknown as Record<string, unknown>).gradient = ["#f00", "#0f0"]
    ;(rarities[0].style as unknown as Record<string, unknown>).glow = "red;} body{display:none"
    cfg.rarities = rarities
    const out = validateStyleConfig(cfg)!
    expect(out.rarities[0].style.color).toBe("#aabbcc")
    expect(out.rarities[0].style).not.toHaveProperty("gradient")
    expect(out.rarities[0].style.glow).toBe("")
    expect(JSON.stringify(out)).not.toContain("display:none")
  })

  it("tolerates an older config with no statSheet.border", () => {
    const cfg = base() as unknown as Record<string, unknown>
    cfg.statSheet = { background: "rgba(128,128,128,0.08)", rounded: true }
    const out = validateStyleConfig(cfg)!
    expect(out.statSheet.border).toBe("currentColor")
  })

  it("replaces an unsafe panel color rather than rejecting the whole config", () => {
    const cfg = base()
    cfg.statSheet.background = "red;} body{display:none"
    const out = validateStyleConfig(cfg)!
    expect(out.statSheet.background).toBe("rgba(128,128,128,0.08)")
  })
})

describe("profile import / export", () => {
  it("round-trips DEFAULT_STYLE_CONFIG through JSON", () => {
    const json = styleConfigToJson(DEFAULT_STYLE_CONFIG)
    const result = styleConfigFromJson(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config).toEqual(DEFAULT_STYLE_CONFIG)
    // …and re-exporting is byte-identical, so a round-trip is lossless.
    expect(styleConfigToJson(result.config)).toBe(json)
    expect(cssFromConfig(result.config)).toBe(cssFromConfig(DEFAULT_STYLE_CONFIG))
  })

  it("round-trips an edited config", () => {
    const cfg = base()
    cfg.rarities[0].style.color = "#123456"
    cfg.keywords[0].words = ["alpha", "beta"]
    cfg.percent.enabled = false
    cfg.statSheet = { border: "#ff0000", background: "transparent", rounded: false }
    const back = styleConfigFromJson(styleConfigToJson(cfg))
    expect(back.ok && back.config).toEqual(cfg)
  })

  it("never throws on malformed input", () => {
    for (const bad of ["", "{", "null", "[]", '"hi"', "{}", '{"rarities":[]}'])
      expect(styleConfigFromJson(bad).ok, JSON.stringify(bad)).toBe(false)
    expect(styleConfigFromJson("{").ok).toBe(false)
    const r = styleConfigFromJson("not json at all")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/valid JSON/)
  })

  it("accepts a wrapped { name, config } export shape", () => {
    const wrapped = JSON.stringify({ name: "Mine", config: DEFAULT_STYLE_CONFIG })
    const r = styleConfigFromJson(wrapped)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config).toEqual(DEFAULT_STYLE_CONFIG)
  })
})

describe("e-reader safety metrics", () => {
  it("computes WCAG luminance and contrast", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5)
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5)
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 3)
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5)
  })

  it("flags colors that vanish against a white or a black page", () => {
    // Near-white: fine on Kindle night mode, invisible in day mode.
    const pale = checkColor("#f5f5f5")
    expect(pale.ok).toBe(false)
    expect(pale.fails).toBe("light")
    // Dark navy: the classic Kindle night-mode disappearance.
    const navy = checkColor("#0b1030")
    expect(navy.ok).toBe(false)
    expect(navy.fails).toBe("dark")
    // Mid grey clears both.
    expect(checkColor("#808080").ok).toBe(true)
  })

  it("perceivedLuminance ignores hue — the e-ink greyscale problem", () => {
    // Two very different hues with near-identical perceived brightness.
    expect(
      Math.abs(perceivedLuminance("#3b82f6") - perceivedLuminance("#3fa45b")),
    ).toBeLessThan(0.1)
    expect(perceivedLuminance("#000000")).toBe(0)
    expect(perceivedLuminance("#ffffff")).toBeCloseTo(1, 5)
  })

  it("audits the built-in config", () => {
    const audit = auditStyleConfig(DEFAULT_STYLE_CONFIG)
    expect(audit.entries.length).toBe(
      DEFAULT_STYLE_CONFIG.rarities.length + DEFAULT_STYLE_CONFIG.keywords.length + 3,
    )
    expect(audit.failing.every((e) => !e.check.ok)).toBe(true)
    // The default panel paints a fill → the night-mode smear hint applies.
    expect(audit.solidPanel).toBe(true)
    // Every entry carries the label the editor shows.
    expect(audit.entries.every((e) => e.label.length > 0)).toBe(true)
  })

  it("reports adjacent tiers that collapse to one grey", () => {
    const cfg = base()
    cfg.rarities[0].style.color = "#3b82f6"
    cfg.rarities[1].style.color = "#3fa45b" // same brightness, different hue
    const audit = auditStyleConfig(cfg)
    expect(
      audit.clashes.some(
        (c) => c.aLabel === cfg.rarities[0].label && c.bLabel === cfg.rarities[1].label,
      ),
    ).toBe(true)
  })

  it("skips percent stops when percentage coloring is off", () => {
    const cfg = base()
    cfg.percent.enabled = false
    expect(auditStyleConfig(cfg).entries.some((e) => e.scope === "percent")).toBe(false)
  })
})

describe("fix for e-ink", () => {
  it("leaves already-safe colors untouched", () => {
    expect(fixColorForEink("#808080")).toBe("#808080")
  })

  it("nudges failing colors into the legible band, keeping hue", () => {
    for (const bad of ["#f5f5f5", "#ffffff", "#000000", "#0b1030", "#fffbe6", "#050505"]) {
      const fixed = fixColorForEink(bad)
      const check = checkColor(fixed)
      expect(check.ok, `${bad} → ${fixed}`).toBe(true)
      expect(check.onWhite).toBeGreaterThanOrEqual(EINK_MIN_CONTRAST)
      expect(check.onBlack).toBeGreaterThanOrEqual(EINK_MIN_CONTRAST)
      // hue preserved (achromatic inputs have no meaningful hue)
      const [h0, s0] = hexToHsl(bad)
      const [h1] = hexToHsl(fixed)
      const dh = Math.abs(h1 - h0)
      if (s0 > 0.05) expect(Math.min(dh, 1 - dh), `${bad} → ${fixed}`).toBeLessThan(0.02)
    }
  })

  it("fixConfigForEink resolves every warning and is non-destructive", () => {
    const before = cloneConfig(DEFAULT_STYLE_CONFIG)
    const fixed = fixConfigForEink(before)
    expect(auditStyleConfig(fixed).failing).toHaveLength(0)
    // the input config is not mutated
    expect(before).toEqual(DEFAULT_STYLE_CONFIG)
    // structure preserved: same tiers, same words, glows retained + re-tinted
    expect(fixed.rarities.map((t) => t.key)).toEqual(before.rarities.map((t) => t.key))
    expect(fixed.rarities.map((t) => t.words)).toEqual(before.rarities.map((t) => t.words))
    for (let i = 0; i < fixed.rarities.length; i++)
      expect(!!fixed.rarities[i].style.glow).toBe(!!before.rarities[i].style.glow)
    // and the result is still a structurally valid config
    expect(validateStyleConfig(fixed)).not.toBeNull()
  })

  it("borderOnlyPanel drops the fill and keeps the border", () => {
    const out = borderOnlyPanel(DEFAULT_STYLE_CONFIG)
    expect(out.statSheet.background).toBe("transparent")
    expect(out.statSheet.border).toBe("currentColor")
    expect(auditStyleConfig(out).solidPanel).toBe(false)
    expect(cssFromConfig(out)).toContain("background:transparent")
    // non-destructive
    expect(DEFAULT_STYLE_CONFIG.statSheet.background).toBe("rgba(128,128,128,0.08)")
  })
})
