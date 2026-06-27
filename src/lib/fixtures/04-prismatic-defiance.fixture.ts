import { expect } from "vitest"

import type { Fixture } from "./types"

// CASE 4 — Prismatic Defiance stat sheet: labeled fields each on their own line.
// Tricky bits: "[Maestro: 1]" inner colon must NOT split; adjacent bracket runs
// like "[A-Rank][B-Rank]…" stay together on the field's line.
const fixture: Fixture = {
  name: "Prismatic Defiance fields split; bracket colons & bracket runs intact",
  blocks: [
    {
      type: "p",
      text:
        "Name: Mythical Prismatic Defiance | Type: Adaptive Bodysuit | Grade: Mythic | Class: Defence",
    },
    {
      type: "p",
      text:
        "Evolution: No Assimilation: Compatible Abilities: [Adaptive][Perfect][Prism][Reversal] " +
        "Augment Slots: [Maestro: 1] [Paragon: 2] " +
        "Augment Range: [A-Rank][B-Rank][C-Rank][D-Rank][E-Rank][F-Rank] " +
        "Materials: [Void Seeker][Void Steel][Vantaplate][Shocksilver] " +
        "Required Rank: Guild [Advisor] Legion System",
    },
  ],
  check(html) {
    const lines = [...html.matchAll(/<div class="stat-line">(.*?)<\/div>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, ""),
    )
    // Header fields each on their own line.
    expect(lines).toContain("Name: Mythical Prismatic Defiance")
    expect(lines).toContain("Type: Adaptive Bodysuit")
    expect(lines).toContain("Grade: Mythic")
    expect(lines).toContain("Class: Defence")
    // Body fields each on their own line.
    expect(lines).toContain("Evolution: No")
    expect(lines).toContain("Augment Slots: [Maestro: 1] [Paragon: 2]")
    expect(lines).toContain("Augment Range: [A-Rank][B-Rank][C-Rank][D-Rank][E-Rank][F-Rank]")
    expect(lines).toContain("Materials: [Void Seeker][Void Steel][Vantaplate][Shocksilver]")
    expect(lines).toContain("Required Rank: Guild [Advisor] Legion System")
    // The inner colon of "[Maestro: 1]" did NOT cause a break.
    expect(lines.some((l) => l === "Maestro: 1]" || l.startsWith("1]"))).toBe(false)
    // Adjacent bracket run stayed glued.
    expect(html).toContain("[A-Rank][B-Rank][C-Rank][D-Rank][E-Rank][F-Rank]")
    // Mythical/Mythic colored in the header.
    expect(html).toMatch(/class="(rarity-mythic|kw-grade-gold)">Mythical/)
    expect(html).toContain('<span class="rarity-mythic">Mythic</span>')
  },
}

export default fixture
