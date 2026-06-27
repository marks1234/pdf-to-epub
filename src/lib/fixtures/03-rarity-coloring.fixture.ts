import { expect } from "vitest"

import type { Fixture } from "./types"

// CASE 3 — Rarity tier coloring + Kindle-safety. Bracketed tags get the right
// rarity class; flat tiers (Common→Epic) are solid colors; Legendary+ are
// solid-color + glow (NEVER the invisible-text gradient technique).
const fixture: Fixture = {
  name: "Rarity tiers colored; CSS is Kindle-safe (no invisible-text patterns)",
  blocks: [
    { type: "li", text: "[Improved] Transference [Grade 18]" },
    { type: "li", text: "[Mythic] Guild: Athena" },
    { type: "li", text: "Crafted Grade Mythic-grade" },
    { type: "li", text: "Name: Mythical Soul Stealer" },
    { type: "li", text: "a Legendary blade and a Godly relic" },
  ],
  check(html, css) {
    // [Improved] → uncommon (green), confirmed working by the user.
    expect(html).toContain('<span class="rarity-uncommon">[Improved]</span>')
    expect(css).toMatch(/\.rarity-uncommon\{color:#[0-9a-f]{6}/i)
    // Bracketed, bare "-grade" suffix, and bare tier name all reach the tier.
    expect(html).toContain('<span class="rarity-mythic">[Mythic]</span>')
    expect(html).toContain('<span class="rarity-mythic">Mythic-grade</span>')
    expect(html).toMatch(/class="(rarity-mythic|kw-grade-gold)">Mythical/)
    expect(html).toContain('class="rarity-legendary"') // bare "Legendary"
    expect(html).toContain('class="rarity-godly"') // bare "Godly"

    // KINDLE-SAFE: the generated CSS and HTML must NEVER hide text.
    for (const poison of [
      "background-clip",
      "-webkit-text-fill-color",
      "color:transparent",
      "color: transparent",
    ]) {
      expect(css, `CSS must not contain "${poison}"`).not.toContain(poison)
      expect(html, `HTML must not contain "${poison}"`).not.toContain(poison)
    }
    // Every rarity tier (incl. legendary+) has a real solid hex color.
    for (const key of ["legendary", "mythic", "divine", "godly"]) {
      expect(css).toMatch(new RegExp(`\\.rarity-${key}\\{color:#[0-9a-f]{6}`, "i"))
    }
  },
}

export default fixture
