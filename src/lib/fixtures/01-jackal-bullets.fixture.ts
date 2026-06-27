import { expect } from "vitest"

import { countOf, statLines, type Fixture } from "./types"

// CASE 1 — Jackal (Drone): "•" bulleted items must each be on their own line,
// and the section labels "Subsume Results" / "Material Results" on their own
// lines (not merged into a run-on paragraph).
const fixture: Fixture = {
  name: "Jackal (Drone) bullets + section labels each on their own line",
  lines: statLines([
    "• [Common] Switcher has been killed.",
    "• Countermeasure Progress: 6%",
    "Subsume Results",
    "• 0.12 Strength has been subsumed.",
    "• 0.09 Endurance has been subsumed.",
    "Material Results",
    "• [Common] Switcher Core has been added to Arsenal.",
    "• [Common] Switcher Sinew has been added to Arsenal.",
  ]),
  check(html) {
    // Six bullets → six list items.
    expect(countOf(html, "<li>")).toBe(6)
    // Section labels are their own lines, not glued to bullets.
    expect(html).toContain('<div class="stat-line">Subsume Results</div>')
    expect(html).toContain('<div class="stat-line">Material Results</div>')
    // Each killed/added bullet is separate (no run-on "killed. •").
    expect(html).toContain("<li>")
    expect(html).not.toMatch(/killed\.[^<]*Countermeasure/)
    // Rarity tag colored.
    expect(html).toContain('<span class="rarity-common">[Common]</span>')
  },
}

export default fixture
