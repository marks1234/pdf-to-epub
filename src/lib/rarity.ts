/**
 * Rarity / tier coloring for stat-sheet text (LitRPG / fantasy "stat blocks").
 *
 * SINGLE SOURCE OF TRUTH: edit `RARITY_TIERS` below to add words, tweak colors,
 * or introduce new tiers. Everything else is derived from it:
 *   - `RARITY_LOOKUP` — the case-insensitive word → CSS class map;
 *   - `RARITY_CSS`    — the stylesheet embedded in the EPUB;
 *   - `colorizeRarities()` — wraps `[Rarity]` tags found in stat-block text.
 *
 * Tiers are ordered low → high. Common … Epic are FLAT colors. Legendary and
 * everything above use a GRADIENT plus a glow/text-shadow. Every gradient tier
 * also sets a solid `color:` first as a fallback, so e-ink / older readers that
 * ignore `background-clip: text` show a sensible solid color rather than
 * invisible text (we never set `color: transparent`).
 */

export interface RarityTier {
  /** Class suffix → `.rarity-<key>`. */
  key: string
  /** Words found inside `[brackets]`, matched case-insensitively. */
  words: string[]
  /** CSS declarations for `.rarity-<key>` (no selector / braces). */
  css: string
}

/** Flat-color tier: readable on both light and dark backgrounds, bold. */
function flat(color: string, weight = 600): string {
  return `color:${color};font-weight:${weight};`
}

/**
 * Gradient tier (Legendary and above). `color` is the solid fallback shown by
 * readers that ignore `background-clip: text`; capable readers reveal the
 * gradient via `-webkit-text-fill-color: transparent`. `glow` is a text-shadow.
 */
function grad(color: string, stops: string, glow: string): string {
  return (
    `color:${color};` +
    `background:linear-gradient(${stops});` +
    `-webkit-background-clip:text;` +
    `background-clip:text;` +
    `-webkit-text-fill-color:transparent;` +
    `text-shadow:${glow};` +
    `font-weight:700;`
  )
}

export const RARITY_TIERS: RarityTier[] = [
  // ── Flat colors ──────────────────────────────────────────────────────────
  {
    key: "broken",
    words: [
      "broken", "trash", "junk", "worn", "crude", "damaged", "cracked",
      "scrap", "ruined", "rusty", "rusted", "decayed", "tattered", "shoddy",
      "flimsy", "defective",
    ],
    css: flat("#6b6b6b"), // dark / muted gray
  },
  {
    key: "common",
    words: [
      "common", "basic", "standard", "normal", "plain", "ordinary", "simple",
      "mundane", "regular", "gray", "grey",
    ],
    css: flat("#9aa0a6"), // neutral gray
  },
  {
    key: "uncommon",
    words: [
      "uncommon", "refined", "quality", "fine", "polished", "improved",
      "enhanced", "sturdy",
    ],
    css: flat("#3fa45b"), // light green
  },
  {
    key: "rare",
    words: ["rare", "superior", "valuable", "precious", "remarkable"],
    css: flat("#3b82f6"), // blue / bluish
  },
  {
    key: "elite",
    words: [
      "elite", "heroic", "hero", "grand", "exceptional", "champion", "royal",
      "majestic",
    ],
    css: flat("#0fb6c2"), // teal / cyan (between rare and epic)
  },
  {
    key: "epic",
    words: [
      "epic", "exquisite", "masterwork", "masterpiece", "flawless", "pristine",
      "magnificent",
    ],
    css: flat("#cf5fc9", 700), // light purplish-pink
  },
  // ── Gradient + glow (Legendary and above) ────────────────────────────────
  {
    key: "legendary",
    words: ["legendary", "legend", "fabled", "mythril", "mithril", "storied"],
    css: grad(
      "#caa53d", // golden fallback
      "90deg,#f9d976,#e6b422,#fff4c2,#d4af37",
      "0 0 3px rgba(212,175,55,.55)",
    ),
  },
  {
    key: "mythic",
    words: ["mythic", "mythical", "ascended", "ascendant"],
    css: grad(
      "#a45ad6", // purple fallback
      "90deg,#a44bd4,#d98bff,#7a2fb0,#c77dff",
      "0 0 4px rgba(170,90,230,.6)",
    ),
  },
  {
    key: "ancient",
    words: ["ancient", "relic", "antique", "timeworn", "forgotten", "primeval"],
    css: grad(
      "#b07a2e", // bronze / amber fallback
      "90deg,#cd7f32,#e8a85a,#8c5a2b,#d9a066",
      "0 0 3px rgba(205,127,50,.5)",
    ),
  },
  {
    key: "artifact",
    words: ["artifact", "artefact", "unique", "set", "named", "signature"],
    css: grad(
      "#e0542b", // orange-red fallback
      "90deg,#ff8a1e,#ff3b2f,#ffb347",
      "0 0 4px rgba(255,80,40,.55)",
    ),
  },
  {
    key: "divine",
    words: ["divine", "celestial", "holy", "sacred", "blessed", "angelic", "hallowed", "seraphic"],
    css: grad(
      "#c8a23a", // white-gold fallback (darker gold for contrast)
      "90deg,#e9c24f,#fff3c0,#d4af37,#fff7d6",
      "0 0 6px rgba(255,240,180,.8)",
    ),
  },
  {
    key: "transcendent",
    words: ["transcendent", "sovereign", "supreme", "exalted", "sublime", "paragon", "peerless", "apex"],
    css: grad(
      "#7a73f5", // iridescent fallback
      "90deg,#ff6ec4,#7873f5,#4ade80,#ffd166",
      "0 0 5px rgba(120,115,245,.55)",
    ),
  },
  {
    key: "primordial",
    words: ["primordial", "cosmic", "eternal", "immortal", "galactic", "astral", "universal", "void"],
    css: grad(
      "#8a7bff", // deep galaxy purple-blue fallback (lightened for dark bg)
      "120deg,#6a3cff,#9d4edd,#3b4fd8,#b06bff",
      "0 0 6px rgba(120,80,255,.65)",
    ),
  },
  {
    key: "godly",
    words: ["godly", "god-tier", "god tier", "godtier", "absolute", "omnipotent", "infinite", "omega", "ultimate"],
    css: grad(
      "#ff5fa2", // prismatic fallback
      "90deg,#ff0040,#ff8a00,#ffe600,#33ff57,#00d0ff,#7a5cff,#ff44e0",
      "0 0 8px rgba(255,255,255,.7),0 0 4px rgba(255,90,160,.6)",
    ),
  },
]

/** Case-insensitive word → CSS class (e.g. `"common"` → `"rarity-common"`). */
export const RARITY_LOOKUP: Map<string, string> = new Map(
  RARITY_TIERS.flatMap((t) => t.words.map((w) => [w.toLowerCase(), `rarity-${t.key}`])),
)

/** Base stat-block styling plus one rule per rarity tier — embedded in the EPUB. */
export const RARITY_CSS: string = [
  ".stat-block{margin:0.5em 0;padding-left:1.5em;list-style:disc;}",
  ".stat-block li{margin:0.15em 0;}",
  ...RARITY_TIERS.map((t) => `.rarity-${t.key}{${t.css}}`),
].join("\n")

// Matches a `[Word]`, `[Two Words]`, or `[God-tier]` bracket tag. Bounded length
// avoids runaway matches; inner is letters/space/apostrophe/plus/hyphen only.
const RARITY_TAG_RE = /\[([A-Za-z][A-Za-z '+-]{0,30}?)\]/g

/**
 * Wrap recognized `[Rarity]` tags in a colored span, keeping the brackets.
 * Only the rarity word need match (case-insensitive); unknown brackets such as
 * `[note]` are left untouched.
 *
 * IMPORTANT: input must already be HTML-escaped. Rarity words contain no
 * HTML-special characters, and brackets aren't escaped, so matching the escaped
 * string is safe and the emitted `<span>` is the only markup introduced.
 *
 * Call this ONLY for stat-sheet content (see scoping in pdf-to-epub.ts) so that
 * bracketed text in ordinary prose is never colorized.
 */
export function colorizeRarities(escapedText: string): string {
  return escapedText.replace(RARITY_TAG_RE, (full, inner: string) => {
    const cls = RARITY_LOOKUP.get(inner.trim().toLowerCase())
    return cls ? `<span class="${cls}">${full}</span>` : full
  })
}
