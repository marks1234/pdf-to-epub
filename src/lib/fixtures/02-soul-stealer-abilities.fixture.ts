import { expect } from "vitest"

import type { Fixture } from "./types"

// CASE 2 — Soul Stealer abilities: "Name: description" entries collapsed into one
// paragraph must each break onto their own line; ordinary prose with a colon in
// the SAME chapter must NOT split.
const fixture: Fixture = {
  name: "Soul Stealer ability entries split; prose with a colon does not",
  blocks: [
    {
      type: "p",
      text:
        "Subsume: Allows the Soul Stealer to permanently acquire the unique ability of a defeated entity, improving attributes and innate abilities. " +
        "Capture: Acquired essence can be efficiently repurposed and stored by the Soul Stealer for later use. " +
        "Phylactery: Allows the Soul Stealer to create a customised physical vessel to hold captured essences. " +
        "Remnant: Allows the Soul Stealer to capture the incomplete Ego of a demonic entity. " +
        "Judgement: Allows the Soul Stealer to rapidly make calculated deductions from visible information. " +
        "Reactor: Grants the Soul Stealer a near endless reserve of unrefined essence, partitioned for efficiency. " +
        "Customised: Mythical Soul Killer set has been created for [Rochelle DeVerdon].",
    },
    {
      type: "p",
      text:
        "He had one rule above all others: never trust a Switcher. It was advice his mother gave him long ago, and it had kept him alive more than once.",
    },
  ],
  check(html) {
    for (const label of [
      "Subsume:",
      "Capture:",
      "Phylactery:",
      "Remnant:",
      "Judgement:",
      "Reactor:",
      "Customised:",
    ]) {
      expect(html, `"${label}" should start its own stat-line`).toContain(
        `<div class="stat-line">${label}`,
      )
    }
    // "Mythical" inside an ability value is still colored.
    expect(html).toMatch(/class="(rarity-mythic|kw-grade-gold)">Mythical/)
    // The prose sentence stays a single <p>, never a stat-line.
    expect(html).toContain("<p>He had one rule above all others: never trust")
    expect(html).not.toMatch(/stat-line">[^<]*never trust/)
  },
}

export default fixture
