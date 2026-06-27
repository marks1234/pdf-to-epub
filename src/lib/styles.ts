/**
 * The styling engine: a single editable {@link StyleConfig} drives every visual
 * decision (rarity tiers, build/status keywords, percentage gradient, stat-sheet
 * panel). {@link createStyler} compiles a config into the EPUB stylesheet plus
 * the colorizer functions used when rendering chapter HTML.
 *
 * This is the source of truth the in-app Style Editor reads and writes; the
 * default config below reproduces the built-in look.
 */

// ── Model ────────────────────────────────────────────────────────────────────

/** A reusable inline text appearance. `gradient` (2+ stops) overrides `color`. */
export interface TextStyle {
  color: string
  gradient: string[]
  glow: string
  bold: boolean
}

/** A rarity tier matched as a bracketed word, e.g. `[Legendary]`. */
export interface RarityTier {
  key: string
  label: string
  words: string[]
  style: TextStyle
}

/** A build/status keyword group matched bracketed or bare, e.g. `Flawless`. */
export interface KeywordGroup {
  key: string
  label: string
  words: string[]
  style: TextStyle
}

/** Percentage gradient: values map low→high across these colors. */
export interface PercentStyle {
  enabled: boolean
  low: string
  mid: string
  high: string
  /** When two percentages sit close together, treat the second as the max. */
  pairMax: boolean
  bold: boolean
}

export interface StatSheetStyle {
  border: string
  background: string
  rounded: boolean
}

export interface StyleConfig {
  rarities: RarityTier[]
  keywords: KeywordGroup[]
  percent: PercentStyle
  statSheet: StatSheetStyle
}

// ── Color helpers ────────────────────────────────────────────────────────────

function flat(color: string, bold = true): TextStyle {
  return { color, gradient: [], glow: "", bold }
}

function grad(color: string, gradient: string[], glow: string): TextStyle {
  return { color, gradient, glow, bold: true }
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const v = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h
  const n = parseInt(v, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Interpolate low→mid→high for a 0..1 ratio. Returns an `rgb(...)` string. */
export function percentColor(ratio: number, p: PercentStyle): string {
  const t = Math.max(0, Math.min(1, ratio))
  const [from, to, local] =
    t < 0.5
      ? [hexToRgb(p.low), hexToRgb(p.mid), t * 2]
      : [hexToRgb(p.mid), hexToRgb(p.high), (t - 0.5) * 2]
  const c = from.map((v, i) => clampByte(lerp(v, to[i], local)))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** CSS declarations for a TextStyle. Gradient text keeps a solid fallback first. */
export function textStyleCss(s: TextStyle): string {
  const weight = s.bold ? "font-weight:600;" : ""
  if (s.gradient.length >= 2) {
    return (
      `color:${s.color};` +
      `background:linear-gradient(90deg,${s.gradient.join(",")});` +
      `-webkit-background-clip:text;background-clip:text;` +
      `-webkit-text-fill-color:transparent;` +
      (s.glow ? `text-shadow:${s.glow};` : "") +
      "font-weight:700;"
    )
  }
  return `color:${s.color};` + (s.glow ? `text-shadow:${s.glow};` : "") + weight
}

// ── Default config (the built-in look) ───────────────────────────────────────

export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  rarities: [
    { key: "broken", label: "Broken", words: ["broken", "trash", "junk", "worn", "crude", "damaged", "cracked", "scrap", "ruined", "rusty", "tattered"], style: flat("#6b6b6b") },
    { key: "common", label: "Common", words: ["common", "basic", "standard", "normal", "plain", "ordinary", "simple", "mundane", "regular"], style: flat("#9aa0a6") },
    { key: "uncommon", label: "Uncommon", words: ["uncommon", "refined", "quality", "fine", "polished", "improved", "enhanced"], style: flat("#3fa45b") },
    { key: "rare", label: "Rare", words: ["rare", "superior", "valuable", "precious", "remarkable"], style: flat("#3b82f6") },
    { key: "elite", label: "Elite", words: ["elite", "heroic", "hero", "grand", "exceptional", "champion", "royal"], style: flat("#0fb6c2") },
    { key: "epic", label: "Epic", words: ["epic", "exquisite", "masterwork", "masterpiece", "flawless", "pristine", "magnificent"], style: flat("#cf5fc9") },
    { key: "legendary", label: "Legendary", words: ["legendary", "legend", "fabled", "mythril", "mithril", "storied"], style: grad("#caa53d", ["#f9d976", "#e6b422", "#fff4c2", "#d4af37"], "0 0 3px rgba(212,175,55,.55)") },
    { key: "mythic", label: "Mythic", words: ["mythic", "mythical", "ascended", "ascendant"], style: grad("#a45ad6", ["#a44bd4", "#d98bff", "#7a2fb0", "#c77dff"], "0 0 4px rgba(170,90,230,.6)") },
    { key: "ancient", label: "Ancient", words: ["ancient", "relic", "antique", "timeworn", "forgotten", "primeval"], style: grad("#b07a2e", ["#cd7f32", "#e8a85a", "#8c5a2b", "#d9a066"], "0 0 3px rgba(205,127,50,.5)") },
    { key: "artifact", label: "Artifact", words: ["artifact", "artefact", "unique", "set", "named", "signature"], style: grad("#e0542b", ["#ff8a1e", "#ff3b2f", "#ffb347"], "0 0 4px rgba(255,80,40,.55)") },
    { key: "divine", label: "Divine", words: ["divine", "celestial", "holy", "sacred", "blessed", "angelic", "hallowed", "seraphic"], style: grad("#c8a23a", ["#e9c24f", "#fff3c0", "#d4af37", "#fff7d6"], "0 0 6px rgba(255,240,180,.8)") },
    { key: "transcendent", label: "Transcendent", words: ["transcendent", "sovereign", "supreme", "exalted", "sublime", "paragon", "peerless", "apex"], style: grad("#7a73f5", ["#ff6ec4", "#7873f5", "#4ade80", "#ffd166"], "0 0 5px rgba(120,115,245,.55)") },
    { key: "primordial", label: "Primordial", words: ["primordial", "cosmic", "eternal", "immortal", "galactic", "astral", "universal", "void"], style: grad("#8a7bff", ["#6a3cff", "#9d4edd", "#3b4fd8", "#b06bff"], "0 0 6px rgba(120,80,255,.65)") },
    { key: "godly", label: "Godly", words: ["godly", "god-tier", "god tier", "godtier", "absolute", "omnipotent", "infinite", "omega", "ultimate"], style: grad("#ff5fa2", ["#ff0040", "#ff8a00", "#ffe600", "#33ff57", "#00d0ff", "#7a5cff", "#ff44e0"], "0 0 8px rgba(255,255,255,.7),0 0 4px rgba(255,90,160,.6)") },
  ],
  keywords: [
    { key: "good", label: "Positive status", words: ["excellent", "suitable", "suitability", "complete", "completed", "available", "active", "guaranteed", "eligible", "unlocked", "stable", "ready", "optimal", "success", "successful", "operational", "online", "approved", "enabled", "installed"], style: flat("#2f9e44") },
    { key: "warn", label: "In-progress / caution", words: ["partial", "probable", "moderate", "recharging", "repairing", "restructuring", "pending", "researching", "untested", "unknown", "standby", "processing", "incomplete", "limited", "calculating", "calculated", "trace", "minimal"], style: flat("#b8860b") },
    { key: "bad", label: "Negative status", words: ["not found", "missing", "inactive", "failed", "failure", "critical", "offline", "locked", "depleted", "error", "blocked", "denied", "insufficient", "unavailable", "damaged", "red zone"], style: flat("#c92a2a") },
    { key: "info", label: "Informational", words: ["important", "significant", "extreme", "extraordinary"], style: flat("#3b82f6") },
    { key: "grade-blue", label: "Grade · advanced", words: ["adept", "advanced", "superior"], style: flat("#3b82f6") },
    { key: "grade-pink", label: "Grade · masterwork", words: ["masterwork", "masterpiece", "flawless", "pristine", "exquisite", "magnificent", "masterful"], style: flat("#cf5fc9") },
    { key: "grade-gold", label: "Grade · mythic", words: ["mythic-grade", "mythical"], style: grad("#a45ad6", ["#a44bd4", "#d98bff", "#7a2fb0", "#c77dff"], "0 0 4px rgba(170,90,230,.6)") },
  ],
  percent: { enabled: true, low: "#d11f1f", mid: "#c2a200", high: "#1f9e3d", pairMax: true, bold: true },
  statSheet: { border: "currentColor", background: "rgba(128,128,128,0.08)", rounded: true },
}

// ── Compiled styler ──────────────────────────────────────────────────────────

const PERCENT_RE = /\d+(?:\.\d+)?%/g
const PAIR_GAP_RE = /^[\s\][:/()]*(?:of)?[\s\][:/()]*$/i
const RARITY_TAG_RE = /\[([A-Za-z][A-Za-z '+-]{0,30}?)\]/g
const SPAN_RE = /<span\b[^>]*>.*?<\/span>/g

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Apply `fn` only outside existing `<span>`s so colorizers never nest. */
function applyOutsideSpans(html: string, fn: (s: string) => string): string {
  let out = ""
  let last = 0
  for (const m of html.matchAll(SPAN_RE)) {
    out += fn(html.slice(last, m.index as number))
    out += m[0]
    last = (m.index as number) + m[0].length
  }
  return out + fn(html.slice(last))
}

export interface Styler {
  config: StyleConfig
  css: string
  /** Escape + rarity + keyword + percent coloring, for stat-sheet text. */
  styleStat(text: string): string
  /** Percentage coloring only (for prose). Input must be escaped. */
  percents(text: string): string
}

/** Compile a {@link StyleConfig} into a stylesheet and colorizer functions. */
export function createStyler(config: StyleConfig): Styler {
  const rarityLookup = new Map<string, string>()
  for (const t of config.rarities)
    for (const w of t.words) rarityLookup.set(w.toLowerCase(), `rarity-${t.key}`)

  const keywordLookup = new Map<string, string>()
  for (const g of config.keywords)
    for (const w of g.words) keywordLookup.set(w.replace(/[ -]+/g, " "), `kw-${g.key}`)

  const allKeywords = config.keywords.flatMap((g) => g.words)
  const keywordRe =
    allKeywords.length > 0
      ? new RegExp(
          "(?<![A-Za-z])(?:" +
            [...allKeywords]
              .sort((a, b) => b.length - a.length)
              .map((p) => escapeRegex(p).replace(/ /g, "[ -]"))
              .join("|") +
            ")(?![A-Za-z])",
          "gi",
        )
      : null

  const rarity = (s: string) =>
    applyOutsideSpans(s, (t) =>
      t.replace(RARITY_TAG_RE, (full, inner: string) => {
        const cls = rarityLookup.get(inner.trim().toLowerCase())
        return cls ? `<span class="${cls}">${full}</span>` : full
      }),
    )

  const keywords = (s: string) =>
    !keywordRe
      ? s
      : applyOutsideSpans(s, (t) =>
          t.replace(keywordRe, (m) => {
            const cls = keywordLookup.get(m.toLowerCase().replace(/[ -]+/g, " "))
            return cls ? `<span class="${cls}">${m}</span>` : m
          }),
        )

  const percents = (s: string) => {
    if (!config.percent.enabled) return s
    return applyOutsideSpans(s, (t) => {
      const hits = [...t.matchAll(PERCENT_RE)].map((m) => ({
        value: parseFloat(m[0]),
        start: m.index as number,
        end: (m.index as number) + m[0].length,
        text: m[0],
      }))
      if (hits.length === 0) return t
      const ratios = hits.map((h) => Math.min(1, h.value / 100))
      if (config.percent.pairMax) {
        for (let i = 0; i < hits.length - 1; i++) {
          const gap = t.slice(hits[i].end, hits[i + 1].start)
          if (gap.length <= 6 && PAIR_GAP_RE.test(gap) && hits[i + 1].value > 0) {
            ratios[i] = Math.min(1, hits[i].value / hits[i + 1].value)
            ratios[i + 1] = 1
            i++
          }
        }
      }
      const weight = config.percent.bold ? "font-weight:700;" : ""
      let out = ""
      let prev = 0
      hits.forEach((h, i) => {
        out += t.slice(prev, h.start)
        out += `<span class="pct" style="${weight}color:${percentColor(ratios[i], config.percent)}">${h.text}</span>`
        prev = h.end
      })
      return out + t.slice(prev)
    })
  }

  return {
    config,
    css: cssFromConfig(config),
    styleStat: (text) => percents(keywords(rarity(escapeForStyler(text)))),
    percents: (text) => percents(text),
  }
}

// escapeHtml duplicated minimally here to keep styles.ts free of reconstruct imports.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g
function escapeForStyler(text: string): string {
  return text.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Build the full EPUB stylesheet from a config. */
export function cssFromConfig(config: StyleConfig): string {
  const ss = config.statSheet
  return [
    `.stat-sheet{margin:1em 0;padding:0.55em 0.85em;border:1px solid ${ss.border};` +
      `border-radius:${ss.rounded ? "8px" : "0"};background:${ss.background};font-size:0.95em;line-height:1.5;}`,
    ".stat-sheet > .stat-line:first-child{font-weight:700;font-size:1.02em;}",
    ".stat-line{margin:0.12em 0;}",
    ".stat-block{margin:0.4em 0;padding-left:1.4em;list-style:disc;}",
    ".stat-block li{margin:0.12em 0;}",
    ".pct{font-weight:700;}",
    ...config.rarities.map((t) => `.rarity-${t.key}{${textStyleCss(t.style)}}`),
    ...config.keywords.map((g) => `.kw-${g.key}{${textStyleCss(g.style)}}`),
  ].join("\n")
}

// ── Editor palette ───────────────────────────────────────────────────────────

/** A curated swatch palette for the Style Editor's color pickers. */
export const PALETTE: { name: string; color: string }[] = [
  { name: "Slate", color: "#64748b" }, { name: "Gray", color: "#9aa0a6" },
  { name: "Stone", color: "#78716c" }, { name: "Red", color: "#dc2626" },
  { name: "Crimson", color: "#c92a2a" }, { name: "Orange", color: "#ea580c" },
  { name: "Amber", color: "#d97706" }, { name: "Gold", color: "#caa53d" },
  { name: "Yellow", color: "#ca8a04" }, { name: "Lime", color: "#65a30d" },
  { name: "Green", color: "#2f9e44" }, { name: "Emerald", color: "#059669" },
  { name: "Teal", color: "#0fb6c2" }, { name: "Cyan", color: "#0891b2" },
  { name: "Sky", color: "#0284c7" }, { name: "Blue", color: "#3b82f6" },
  { name: "Indigo", color: "#4f46e5" }, { name: "Violet", color: "#7c3aed" },
  { name: "Purple", color: "#a45ad6" }, { name: "Fuchsia", color: "#cf5fc9" },
  { name: "Pink", color: "#db2777" }, { name: "Rose", color: "#e11d48" },
]

/** A few ready-made gradient presets users can apply to a tier. */
export const GRADIENT_PRESETS: { name: string; stops: string[]; glow: string }[] = [
  { name: "Gold", stops: ["#f9d976", "#e6b422", "#fff4c2", "#d4af37"], glow: "0 0 3px rgba(212,175,55,.55)" },
  { name: "Amethyst", stops: ["#a44bd4", "#d98bff", "#7a2fb0", "#c77dff"], glow: "0 0 4px rgba(170,90,230,.6)" },
  { name: "Bronze", stops: ["#cd7f32", "#e8a85a", "#8c5a2b", "#d9a066"], glow: "0 0 3px rgba(205,127,50,.5)" },
  { name: "Inferno", stops: ["#ff8a1e", "#ff3b2f", "#ffb347"], glow: "0 0 4px rgba(255,80,40,.55)" },
  { name: "Iridescent", stops: ["#ff6ec4", "#7873f5", "#4ade80", "#ffd166"], glow: "0 0 5px rgba(120,115,245,.55)" },
  { name: "Galaxy", stops: ["#6a3cff", "#9d4edd", "#3b4fd8", "#b06bff"], glow: "0 0 6px rgba(120,80,255,.65)" },
  { name: "Prismatic", stops: ["#ff0040", "#ff8a00", "#ffe600", "#33ff57", "#00d0ff", "#7a5cff", "#ff44e0"], glow: "0 0 8px rgba(255,255,255,.7)" },
]

/** Deep clone a config so the editor can mutate a draft safely. */
export function cloneConfig(c: StyleConfig): StyleConfig {
  return structuredClone(c)
}
