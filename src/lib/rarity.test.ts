import { describe, it, expect } from "vitest"

import {
  colorizeRarities,
  colorizePercents,
  colorizeStatKeywords,
  ratioColor,
  RARITY_LOOKUP,
  RARITY_CSS,
  RARITY_TIERS,
} from "./rarity"

describe("colorizeRarities", () => {
  it("wraps a known rarity tag, keeping the brackets", () => {
    expect(colorizeRarities("[Common] Switcher has been killed.")).toBe(
      '<span class="rarity-common">[Common]</span> Switcher has been killed.',
    )
  })

  it("matches case-insensitively", () => {
    expect(colorizeRarities("[LEGENDARY] sword")).toBe(
      '<span class="rarity-legendary">[LEGENDARY]</span> sword',
    )
    expect(colorizeRarities("[mythic]")).toBe(
      '<span class="rarity-mythic">[mythic]</span>',
    )
  })

  it("handles multi-word and hyphenated tiers", () => {
    expect(colorizeRarities("[God Tier]")).toBe(
      '<span class="rarity-godly">[God Tier]</span>',
    )
    expect(colorizeRarities("[God-tier]")).toBe(
      '<span class="rarity-godly">[God-tier]</span>',
    )
  })

  it("leaves unknown bracket tags untouched", () => {
    expect(colorizeRarities("[note] and [Subsume Results]")).toBe(
      "[note] and [Subsume Results]",
    )
  })

  it("colorizes multiple tags in one string", () => {
    const out = colorizeRarities("[Common] core and [Rare] sinew")
    expect(out).toBe(
      '<span class="rarity-common">[Common]</span> core and ' +
        '<span class="rarity-rare">[Rare]</span> sinew',
    )
  })
})

describe("rarity table integrity", () => {
  it("never maps the same word to two different tiers", () => {
    const seen = new Map<string, string>()
    for (const tier of RARITY_TIERS) {
      for (const word of tier.words) {
        const w = word.toLowerCase()
        expect(seen.has(w), `duplicate rarity word: "${w}"`).toBe(false)
        seen.set(w, tier.key)
      }
    }
  })

  it("emits a CSS rule for every tier", () => {
    for (const tier of RARITY_TIERS) {
      expect(RARITY_CSS).toContain(`.rarity-${tier.key}{`)
    }
  })

  it("gives every gradient tier (legendary+) a solid color fallback before the gradient", () => {
    const gradientStart = RARITY_TIERS.findIndex((t) => t.key === "legendary")
    for (const tier of RARITY_TIERS.slice(gradientStart)) {
      // A solid `color:` must appear, and it must come before `background:`
      // so readers ignoring background-clip never render invisible text.
      const colorAt = tier.css.indexOf("color:")
      const bgAt = tier.css.indexOf("background:")
      expect(tier.css).toContain("linear-gradient(")
      expect(colorAt).toBeGreaterThanOrEqual(0)
      expect(colorAt).toBeLessThan(bgAt)
      // The `color:` property itself must be solid (the `-webkit-text-fill-color:
      // transparent` that reveals the gradient is fine and expected).
      expect(tier.css).not.toMatch(/(^|;)color:transparent/)
      expect(tier.css).toContain("text-shadow:")
    }
  })

  it("uses flat colors (no gradient) for common through epic", () => {
    for (const key of ["broken", "common", "uncommon", "rare", "elite", "epic"]) {
      const tier = RARITY_TIERS.find((t) => t.key === key)!
      expect(tier.css).not.toContain("linear-gradient")
    }
  })

  it("exposes the expected lookup entries", () => {
    expect(RARITY_LOOKUP.get("common")).toBe("rarity-common")
    expect(RARITY_LOOKUP.get("legendary")).toBe("rarity-legendary")
    expect(RARITY_LOOKUP.get("god tier")).toBe("rarity-godly")
  })
})

describe("colorizePercents", () => {
  it("colors a standalone percentage by value/100", () => {
    expect(colorizePercents("Progress: 100%")).toBe(
      `Progress: <span class="pct" style="color:${ratioColor(1)}">100%</span>`,
    )
    expect(colorizePercents("at 0%")).toContain(ratioColor(0))
  })

  it("treats the second of a close pair as the max (green) and ratios the first", () => {
    const out = colorizePercents("[2.2% of 20%]")
    // first colored by 2.2/20 = 0.11, second (max) green.
    expect(out).toBe(
      `[<span class="pct" style="color:${ratioColor(0.11)}">2.2%</span> of ` +
        `<span class="pct" style="color:${ratioColor(1)}">20%</span>]`,
    )
  })

  it("does not pair percentages separated by prose", () => {
    const out = colorizePercents("up 61% then later 57% elsewhere")
    expect(out).toContain(ratioColor(0.61))
    expect(out).toContain(ratioColor(0.57))
    expect(out).not.toContain(ratioColor(1)) // neither treated as a max
  })

  it("maps ratios red→green via hue", () => {
    expect(ratioColor(0)).toBe("hsl(0,80%,42%)")
    expect(ratioColor(0.5)).toBe("hsl(60,80%,42%)")
    expect(ratioColor(1)).toBe("hsl(120,80%,42%)")
  })
})

describe("colorizeStatKeywords", () => {
  it("colors status words by good/warn/bad", () => {
    expect(colorizeStatKeywords("[Suitability: Excellent]")).toContain(
      '<span class="status-good">Excellent</span>',
    )
    expect(colorizeStatKeywords("[Recharging]")).toContain('class="status-warn"')
    expect(colorizeStatKeywords("[Not Found]")).toBe(
      '[<span class="status-bad">Not Found</span>]',
    )
  })

  it("colors grade words with the matching rarity class", () => {
    expect(colorizeStatKeywords("Crafted Grade Mythic-Grade")).toContain(
      '<span class="rarity-mythic">Mythic-Grade</span>',
    )
    expect(colorizeStatKeywords("Build Quality Flawless")).toContain(
      '<span class="rarity-epic">Flawless</span>',
    )
    expect(colorizeStatKeywords("[Advanced] tower")).toContain('class="rarity-rare"')
  })

  it("does not match a keyword embedded in a larger word", () => {
    expect(colorizeStatKeywords("completely active radioactive")).toBe(
      'completely <span class="status-good">active</span> radioactive',
    )
  })
})
