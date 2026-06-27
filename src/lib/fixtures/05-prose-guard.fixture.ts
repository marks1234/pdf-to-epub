import { expect } from "vitest"

import { statLines, type Fixture } from "./types"

// CASE 5 — NEGATIVE GUARD. Ordinary narrative prose (with colons, a bracket, and
// soft-wrapped lines) must pass through UNCHANGED: soft-wrapped lines merge into
// ONE paragraph, nothing is boxed or split, and the text is preserved verbatim.
const fixture: Fixture = {
  name: "Ordinary prose with colons/brackets passes through unchanged",
  lines: statLines([
    "The drone hovered at the edge of the clearing, its sensors sweeping",
    "the treeline for any sign of movement: nothing stirred. He counted",
    "three exits, noted the [shattered] window, and waited for the signal.",
  ]),
  check(html) {
    // Exactly one paragraph, no stat-sheet machinery.
    expect(html.match(/<p>/g)?.length).toBe(1)
    expect(html).not.toContain("stat-sheet")
    expect(html).not.toContain("stat-line")
    expect(html).not.toContain("<li>")
    // Soft-wrapped lines merged, colon and bracket preserved verbatim.
    expect(html).toContain("movement: nothing stirred")
    expect(html).toContain("the [shattered] window")
    expect(html).toBe(
      "<p>The drone hovered at the edge of the clearing, its sensors sweeping " +
        "the treeline for any sign of movement: nothing stirred. He counted " +
        "three exits, noted the [shattered] window, and waited for the signal.</p>",
    )
  },
}

export default fixture
