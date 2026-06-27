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
  // Stat-sheet panel: a bordered, tinted box that reads as a game UI readout and
  // stays legible on both light and dark backgrounds (uses currentColor + a faint
  // neutral tint rather than fixed colors).
  ".stat-sheet{margin:1em 0;padding:0.55em 0.85em;border:1px solid currentColor;" +
    "border-radius:8px;background:rgba(128,128,128,0.08);font-size:0.95em;line-height:1.5;}",
  ".stat-sheet > .stat-line:first-child{font-weight:700;font-size:1.02em;}",
  ".stat-line{margin:0.12em 0;}",
  ".stat-block{margin:0.4em 0;padding-left:1.4em;list-style:disc;}",
  ".stat-block li{margin:0.12em 0;}",
  // Percentages: a base weight; the red→green hue is an inline style per value.
  ".pct{font-weight:700;}",
  // Build/status keywords.
  ".status-good{color:#2f9e44;font-weight:600;}",
  ".status-warn{color:#b8860b;font-weight:600;}",
  ".status-bad{color:#c92a2a;font-weight:600;}",
  ".status-info{color:#3b82f6;font-weight:600;}",
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
  return applyOutsideSpans(escapedText, (s) =>
    s.replace(RARITY_TAG_RE, (full, inner: string) => {
      const cls = RARITY_LOOKUP.get(inner.trim().toLowerCase())
      return cls ? `<span class="${cls}">${full}</span>` : full
    }),
  )
}

// ── Percentages ────────────────────────────────────────────────────────────

/**
 * Map a 0..1 ratio to a red→amber→green color. HSL keeps a constant, mid
 * lightness so every step is legible on both light and dark backgrounds.
 */
export function ratioColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio))
  const hue = Math.round(120 * t) // 0 = red, 60 = amber, 120 = green
  return `hsl(${hue},80%,42%)`
}

const PERCENT_RE = /\d+(?:\.\d+)?%/g
// A short run of separators (optionally the word "of") between two percentages —
// e.g. "0.6% of 10%", "2.2%] [20%", "[4.9%]/[100%]" — marks them as a pair.
const PAIR_GAP_RE = /^[\s\][:/()]*(?:of)?[\s\][:/()]*$/i

/**
 * Color percentages on a red→green gradient. When two percentages sit close
 * together (e.g. "0.6% of 10%"), the SECOND is taken as the maximum — rendered
 * green — and the first is colored by its ratio to that max. Standalone
 * percentages are colored by value/100. Applied to all text (the user wants
 * every percentage colored), outside any existing spans. Input must be escaped.
 */
export function colorizePercents(escapedText: string): string {
  return applyOutsideSpans(escapedText, (s) => {
    const hits = [...s.matchAll(PERCENT_RE)].map((m) => ({
      value: parseFloat(m[0]),
      start: m.index as number,
      end: (m.index as number) + m[0].length,
      text: m[0],
    }))
    if (hits.length === 0) return s

    const ratios = hits.map((h) => Math.min(1, h.value / 100))
    for (let i = 0; i < hits.length - 1; i++) {
      const gap = s.slice(hits[i].end, hits[i + 1].start)
      if (gap.length <= 6 && PAIR_GAP_RE.test(gap) && hits[i + 1].value > 0) {
        ratios[i] = Math.min(1, hits[i].value / hits[i + 1].value)
        ratios[i + 1] = 1 // the max → green
        i++ // consume both halves of the pair
      }
    }

    let out = ""
    let prev = 0
    hits.forEach((h, i) => {
      out += s.slice(prev, h.start)
      out += `<span class="pct" style="color:${ratioColor(ratios[i])}">${h.text}</span>`
      prev = h.end
    })
    return out + s.slice(prev)
  })
}

// ── Build / status keywords ──────────────────────────────────────────────────

/**
 * Status and build-quality words → CSS class. Status words use the red→green
 * `status-*` palette; grade words reuse the rarity tier colors. Matched
 * case-insensitively, bracketed or bare, but ONLY inside stat sheets (see
 * reconstruct.ts) so prose words like "complete" or "active" are never colored.
 * Edit freely — this is the single source for build-keyword styling.
 */
export const KEYWORD_LOOKUP: Map<string, string> = new Map([
  // Positive status → green
  ...[
    "excellent", "suitable", "suitability", "complete", "completed", "available",
    "active", "guaranteed", "eligible", "unlocked", "stable", "ready", "optimal",
    "success", "successful", "operational", "online", "approved", "enabled", "installed",
  ].map((w) => [w, "status-good"] as const),
  // Caution / in-progress → amber
  ...[
    "partial", "probable", "moderate", "recharging", "repairing", "restructuring",
    "pending", "researching", "untested", "unknown", "standby", "processing",
    "incomplete", "limited", "calculating", "calculated", "trace", "minimal",
  ].map((w) => [w, "status-warn"] as const),
  // Negative → red
  ...[
    "not found", "missing", "inactive", "failed", "failure", "critical", "offline",
    "locked", "depleted", "error", "blocked", "denied", "insufficient",
    "unavailable", "damaged", "red zone",
  ].map((w) => [w, "status-bad"] as const),
  // Informational → blue
  ...["important", "significant", "extreme", "extraordinary"].map(
    (w) => [w, "status-info"] as const,
  ),
  // Grades / build quality → rarity tier colors
  ...[
    ["crude", "rarity-broken"], ["worn", "rarity-broken"],
    ["basic", "rarity-common"], ["standard", "rarity-common"],
    ["refined", "rarity-uncommon"], ["improved", "rarity-uncommon"],
    ["adept", "rarity-rare"], ["advanced", "rarity-rare"], ["superior", "rarity-rare"],
    ["heroic", "rarity-elite"], ["grand", "rarity-elite"],
    ["exquisite", "rarity-epic"], ["flawless", "rarity-epic"], ["pristine", "rarity-epic"],
    ["masterwork", "rarity-epic"], ["masterpiece", "rarity-epic"],
    ["mythic-grade", "rarity-mythic"], ["mythic", "rarity-mythic"],
    ["mythical", "rarity-mythic"], ["fabled", "rarity-legendary"],
  ].map(([w, c]) => [w, c] as const),
])

// Normalized lookup: separators (space/hyphen) collapsed to a single space, so a
// match like "Mythic-Grade" or "Not Found" resolves regardless of the separator.
const KEYWORD_NORM: Map<string, string> = new Map(
  [...KEYWORD_LOOKUP].map(([k, v]) => [k.replace(/[ -]+/g, " "), v]),
)
const KEYWORD_RE = buildKeywordRegex([...KEYWORD_LOOKUP.keys()])

function buildKeywordRegex(phrases: string[]): RegExp {
  // Longest first so multi-word / hyphenated phrases win over their prefixes.
  const alts = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ -]"))
    .join("|")
  // Letter-boundary lookarounds (not \b) so hyphens/colons don't split phrases.
  return new RegExp(`(?<![A-Za-z])(?:${alts})(?![A-Za-z])`, "gi")
}

/**
 * Color build/status keywords. Input must be escaped; applied outside existing
 * spans so it never double-wraps a rarity or percentage span.
 */
export function colorizeStatKeywords(escapedText: string): string {
  return applyOutsideSpans(escapedText, (s) =>
    s.replace(KEYWORD_RE, (m) => {
      const cls = KEYWORD_NORM.get(m.toLowerCase().replace(/[ -]+/g, " "))
      return cls ? `<span class="${cls}">${m}</span>` : m
    }),
  )
}

// ── Shared helper ────────────────────────────────────────────────────────────

const SPAN_RE = /<span\b[^>]*>.*?<\/span>/g

/**
 * Apply `fn` only to the parts of `html` that are NOT already inside a `<span>`.
 * Lets the colorizers compose without nesting or double-wrapping each other's
 * output. Spans here never nest, so a flat scan is sufficient.
 */
export function applyOutsideSpans(html: string, fn: (s: string) => string): string {
  let out = ""
  let last = 0
  for (const m of html.matchAll(SPAN_RE)) {
    out += fn(html.slice(last, m.index as number))
    out += m[0]
    last = (m.index as number) + m[0].length
  }
  return out + fn(html.slice(last))
}
