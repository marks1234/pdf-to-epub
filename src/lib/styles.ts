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

/**
 * A reusable inline text appearance. `color` is always a real, visible color
 * (Kindle-safe — see {@link textStyleCss}). `glow` is an optional text-shadow
 * for "fancy" tiers.
 *
 * There is deliberately NO gradient field: a `linear-gradient` anywhere in the
 * book's CSS disables Kindle Enhanced Typesetting for the whole title, and
 * gradient-on-text is invisible there anyway. Saved configs that still carry a
 * legacy `gradient` array are silently dropped by {@link validateStyleConfig}.
 */
export interface TextStyle {
  color: string
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

/**
 * The stat-sheet panel. `border`/`background` accept a hex color, `transparent`,
 * `currentColor`, or an `rgb()/rgba()` value — anything else is replaced with the
 * default (see {@link safePanelColor}). Kindle night mode paints `background`
 * fills as a grey smear, so a border-only panel (`background: "transparent"`)
 * is the e-ink-safe choice.
 */
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
  return { color, glow: "", bold }
}

// Legendary+ "fancy" tier: a solid, visible color plus a glow derived from it.
// (We deliberately do NOT use a CSS gradient — see textStyleCss.) The second arg
// is the legacy gradient stops, kept at the call sites as documentation but
// ignored; `glow` is what actually renders.
function grad(color: string, _stops: string[], glow: string): TextStyle {
  return { color, glow, bold: true }
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/** The color used whenever a configured/imported color fails validation. */
export const FALLBACK_COLOR = "#808080"
/** The fallback glow used when a color can't be parsed. */
const FALLBACK_GLOW = "0 0 4px rgba(120,120,120,0.5)"

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Strict hex parser and the single gate every color passes through before it
 * reaches the EPUB stylesheet. Accepts only `#rgb` / `#rrggbb`; returns the
 * expanded lowercase 6-digit form, or `null` for anything else (`red`, `#abcd`,
 * `rgb(1,2,3)`, `"red;} body{display:none"`, non-strings, …).
 */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (!HEX_RE.test(v)) return null
  const h = v.slice(1).toLowerCase()
  return `#${h.length === 3 ? h.replace(/(.)/g, "$1$1") : h}`
}

/** {@link normalizeHex} with a safe default — use at every CSS boundary. */
export function safeColor(value: unknown, fallback: string = FALLBACK_COLOR): string {
  return normalizeHex(value) ?? fallback
}

// Panel fills may also be `transparent` / `currentColor` / an rgb(a) triple.
const RGB_FN_RE =
  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,4})\s*)?\)$/i
const COLOR_KEYWORDS = ["transparent", "currentcolor", "inherit"]

/**
 * Sanitize a stat-sheet panel color. Allows hex, the keywords above and
 * `rgb()/rgba()`; everything else (including CSS-injection attempts such as
 * `red;} body{display:none`) falls back to `fallback`.
 */
export function safePanelColor(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const v = value.trim()
    const hex = normalizeHex(v)
    if (hex) return hex
    // Both branches only ever return input matched wholly by a strict pattern,
    // so the original spelling (e.g. `currentColor`) is preserved safely.
    if (COLOR_KEYWORDS.includes(v.toLowerCase())) return v
    if (RGB_FN_RE.test(v)) return v
  }
  return fallback
}

// A text-shadow value may only contain these characters — no `;`, `{`, `}`, `:`
// or `*`, so it can never terminate the declaration it sits in.
const SHADOW_RE = /^[0-9a-z#.,()%\s-]{1,240}$/i

/** Sanitize a `text-shadow` value; anything suspicious becomes "" (no glow). */
export function safeShadow(value: unknown): string {
  if (typeof value !== "string") return ""
  const v = value.trim()
  return v && SHADOW_RE.test(v) ? v : ""
}

// CSS class keys come from the config, so they are part of the stylesheet and of
// the emitted `class=` attributes. Keep them to a safe identifier.
function safeKey(key: unknown): string {
  const k = String(key ?? "").replace(/[^A-Za-z0-9_-]/g, "")
  return /^[A-Za-z]/.test(k) ? k : `k${k}`
}

function hexToRgb(hex: string): [number, number, number] {
  const v = (normalizeHex(hex) ?? FALLBACK_COLOR).slice(1)
  const n = parseInt(v, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A soft glow (text-shadow) derived from a color — used for legendary+ tiers. */
export function glowFor(color: string): string {
  if (!normalizeHex(color)) return FALLBACK_GLOW
  const [r, g, b] = hexToRgb(color)
  return `0 0 4px rgba(${r},${g},${b},0.6)`
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Interpolate low→mid→high for a 0..1 ratio. Returns an `rgb(...)` string.
 * Invalid stops (and a NaN/undefined ratio) degrade to the fallback grey rather
 * than emitting `rgb(NaN,NaN,NaN)` into the shipped EPUB.
 */
export function percentColor(ratio: number, p: PercentStyle): string {
  const t = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
  const low = safeColor(p?.low)
  const mid = safeColor(p?.mid)
  const high = safeColor(p?.high)
  const [from, to, local] =
    t < 0.5
      ? [hexToRgb(low), hexToRgb(mid), t * 2]
      : [hexToRgb(mid), hexToRgb(high), (t - 0.5) * 2]
  const c = from.map((v, i) => clampByte(lerp(v, to[i], local)))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/**
 * CSS declarations for a TextStyle. KINDLE-SAFE: the text is always a real,
 * visible solid color. We never use `background-clip:text` + transparent fill —
 * Kindle ignores the clip but honors the transparent text, leaving an invisible
 * colored rectangle. "Fancy" tiers (legendary+) instead get a `text-shadow`
 * glow, heavier weight and a hint of letter-spacing — all of which degrade
 * gracefully to plain solid bold text when unsupported.
 */
export function textStyleCss(s: TextStyle): string {
  const color = safeColor(s?.color)
  const glow = safeShadow(s?.glow)
  let css = `color:${color};`
  if (glow) css += `text-shadow:${glow};letter-spacing:0.02em;`
  css += `font-weight:${glow ? 700 : s?.bold ? 600 : 400};`
  return css
}

// ── Default config (the built-in look) ───────────────────────────────────────

/** The built-in stat-sheet panel; also the fallback for invalid panel colors. */
export const DEFAULT_STAT_SHEET: StatSheetStyle = {
  border: "currentColor",
  background: "rgba(128,128,128,0.08)",
  rounded: true,
}

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
  statSheet: { ...DEFAULT_STAT_SHEET },
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
  // Class names must be derived exactly as cssFromConfig derives its selectors.
  const rarityLookup = new Map<string, string>()
  for (const t of config.rarities)
    for (const w of t.words) rarityLookup.set(w.toLowerCase(), `rarity-${safeKey(t.key)}`)

  // Bare/keyword forms → class. Includes the configured keyword groups plus an
  // auto-derived "<rarityword>-grade" form (e.g. "Mythic-grade", "Legendary-grade")
  // that maps to the tier color. The required "-grade" suffix keeps these bare
  // matches safe from ordinary prose (unlike bare tier words like "set"/"fine").
  const keywordEntries: [string, string][] = []
  for (const g of config.keywords)
    for (const w of g.words) keywordEntries.push([w, `kw-${safeKey(g.key)}`])
  for (const t of config.rarities) {
    // Bare tier name (e.g. "Grade: Mythic") and "<word>-grade" forms (e.g.
    // "Mythic-grade", "Legendary-grade") → the tier color. Bare matching uses the
    // distinctive tier key only (not generic synonyms), and is stat-scoped.
    keywordEntries.push([t.key, `rarity-${safeKey(t.key)}`])
    for (const w of t.words) keywordEntries.push([`${w}-grade`, `rarity-${safeKey(t.key)}`])
  }

  const keywordLookup = new Map<string, string>()
  for (const [phrase, cls] of keywordEntries)
    keywordLookup.set(phrase.replace(/[ -]+/g, " "), cls)

  const allKeywords = keywordEntries.map(([phrase]) => phrase)
  const keywordRe =
    allKeywords.length > 0
      ? new RegExp(
          "(?<![A-Za-z])(?:" +
            [...allKeywords]
              .sort((a, b) => b.length - a.length)
              .map((p) => escapeRegex(p).replace(/[ -]/g, "[ -]"))
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

/**
 * Build the full EPUB stylesheet from a config. Every interpolated value is
 * sanitized first — a config field is untrusted input (it can come from
 * localStorage, an imported profile or a free-text color box), and an
 * unescaped `;}` would let it inject arbitrary rules into the book.
 */
export function cssFromConfig(config: StyleConfig): string {
  const ss = config.statSheet
  const border = safePanelColor(ss?.border, DEFAULT_STAT_SHEET.border)
  const background = safePanelColor(ss?.background, DEFAULT_STAT_SHEET.background)
  return [
    `.stat-sheet{margin:1em 0;padding:0.55em 0.85em;border:1px solid ${border};` +
      `border-radius:${ss?.rounded ? "8px" : "0"};background:${background};font-size:0.95em;line-height:1.5;}`,
    ".stat-sheet > .stat-line:first-child{font-weight:700;font-size:1.02em;}",
    ".stat-line{margin:0.12em 0;}",
    ".stat-block{margin:0.4em 0;padding-left:1.4em;list-style:disc;}",
    ".stat-block li{margin:0.12em 0;}",
    ".pct{font-weight:700;}",
    ...config.rarities.map((t) => `.rarity-${safeKey(t.key)}{${textStyleCss(t.style)}}`),
    ...config.keywords.map((g) => `.kw-${safeKey(g.key)}{${textStyleCss(g.style)}}`),
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

/** Deep clone a config so the editor can mutate a draft safely. */
export function cloneConfig(c: StyleConfig): StyleConfig {
  return structuredClone(c)
}

// ── Structural validation ────────────────────────────────────────────────────

/**
 * Validate an untrusted value (imported JSON, a localStorage blob, an old saved
 * profile) as a {@link StyleConfig}. Returns a freshly built, fully sanitized
 * config — unknown properties (including the legacy `gradient`) are dropped and
 * every color/shadow is normalized — or an `error` describing the first problem.
 *
 * Tolerated for backward compatibility: a missing `statSheet.border` (defaults
 * to the built-in `currentColor`), a missing `glow` ("") and a missing `bold`
 * (`false`).
 */
export type StyleConfigResult =
  | { ok: true; config: StyleConfig }
  | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function validateTextStyle(v: unknown, where: string): TextStyle | string {
  if (!isRecord(v)) return `${where}: "style" must be an object`
  const color = normalizeHex(v.color)
  if (!color) return `${where}: invalid color ${JSON.stringify(v.color ?? null)} (expected #rgb or #rrggbb)`
  if (v.glow !== undefined && typeof v.glow !== "string")
    return `${where}: "glow" must be a string`
  if (v.bold !== undefined && typeof v.bold !== "boolean")
    return `${where}: "bold" must be a boolean`
  return { color, glow: safeShadow(v.glow), bold: v.bold === true }
}

const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

function validateGroups(
  v: unknown,
  field: "rarities" | "keywords",
): RarityTier[] | string {
  if (!Array.isArray(v)) return `"${field}" must be an array`
  const out: RarityTier[] = []
  const seen = new Set<string>()
  for (let i = 0; i < v.length; i++) {
    const where = `${field}[${i}]`
    const g = v[i]
    if (!isRecord(g)) return `${where} must be an object`
    if (typeof g.key !== "string" || !KEY_RE.test(g.key))
      return `${where}: invalid "key" ${JSON.stringify(g.key ?? null)} (letters, digits, - and _ only)`
    if (seen.has(g.key)) return `${where}: duplicate key "${g.key}"`
    seen.add(g.key)
    if (typeof g.label !== "string") return `${where}: "label" must be a string`
    if (!Array.isArray(g.words) || g.words.some((w) => typeof w !== "string"))
      return `${where}: "words" must be an array of strings`
    const style = validateTextStyle(g.style, where)
    if (typeof style === "string") return style
    out.push({
      key: g.key,
      label: g.label,
      words: (g.words as string[]).map((w) => w.trim().toLowerCase()).filter(Boolean),
      style,
    })
  }
  return out
}

/** {@link validateStyleConfig} with a human-readable reason on failure. */
export function validateStyleConfigDetailed(v: unknown): StyleConfigResult {
  if (!isRecord(v)) return { ok: false, error: "Not a style config object." }

  const rarities = validateGroups(v.rarities, "rarities")
  if (typeof rarities === "string") return { ok: false, error: rarities }
  const keywords = validateGroups(v.keywords, "keywords")
  if (typeof keywords === "string") return { ok: false, error: keywords }

  const p = v.percent
  if (!isRecord(p)) return { ok: false, error: '"percent" must be an object' }
  const stops: Record<"low" | "mid" | "high", string> = { low: "", mid: "", high: "" }
  for (const k of ["low", "mid", "high"] as const) {
    const hex = normalizeHex(p[k])
    if (!hex)
      return { ok: false, error: `percent.${k}: invalid color ${JSON.stringify(p[k] ?? null)} (expected #rgb or #rrggbb)` }
    stops[k] = hex
  }
  for (const k of ["enabled", "pairMax", "bold"] as const)
    if (p[k] !== undefined && typeof p[k] !== "boolean")
      return { ok: false, error: `percent.${k} must be a boolean` }

  const ss = v.statSheet
  if (!isRecord(ss)) return { ok: false, error: '"statSheet" must be an object' }
  if (ss.rounded !== undefined && typeof ss.rounded !== "boolean")
    return { ok: false, error: "statSheet.rounded must be a boolean" }

  return {
    ok: true,
    config: {
      rarities,
      keywords: keywords as KeywordGroup[],
      percent: {
        enabled: p.enabled !== false,
        low: stops.low,
        mid: stops.mid,
        high: stops.high,
        pairMax: p.pairMax !== false,
        bold: p.bold !== false,
      },
      statSheet: {
        border: safePanelColor(ss.border, DEFAULT_STAT_SHEET.border),
        background: safePanelColor(ss.background, DEFAULT_STAT_SHEET.background),
        rounded: ss.rounded !== false,
      },
    },
  }
}

/**
 * Structural validation for untrusted style configs — imported JSON, a
 * localStorage blob, a saved profile written by an older version. Returns a
 * sanitized config, or `null` when the value isn't a usable one.
 */
export function validateStyleConfig(v: unknown): StyleConfig | null {
  const r = validateStyleConfigDetailed(v)
  return r.ok ? r.config : null
}

// ── Import / export ──────────────────────────────────────────────────────────

/** Serialize a config for the `.json` profile download. */
export function styleConfigToJson(config: StyleConfig): string {
  return JSON.stringify(config, null, 2)
}

/** Parse + validate a profile `.json`; never throws. */
export function styleConfigFromJson(text: string): StyleConfigResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: "That file isn't valid JSON." }
  }
  // Tolerate a wrapped export ({ name, config }) as well as a bare config.
  if (isRecord(parsed) && isRecord(parsed.config) && !("rarities" in parsed))
    parsed = parsed.config
  return validateStyleConfigDetailed(parsed)
}

// ── E-reader (e-ink / night mode) safety ─────────────────────────────────────

/**
 * Minimum WCAG contrast a text color must reach against BOTH page backgrounds.
 * Kindle night mode forces a black page with no per-book override, so a color
 * only has to be dark to vanish there — and only light to vanish in day mode.
 */
export const EINK_MIN_CONTRAST = 2.5
/** Below this perceived-luminance gap two tiers are one grey on e-ink. */
export const EINK_MIN_GREY_GAP = 0.1

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance (0 = black, 1 = white). */
export function relativeLuminance(color: string): number {
  const [r, g, b] = hexToRgb(safeColor(color))
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Perceived (greyscale) luminance, 0..1 — what a monochrome e-ink panel keeps
 * once hue is discarded. Two colors with the same value are indistinguishable
 * there no matter how different they look in color.
 */
export function perceivedLuminance(color: string): number {
  const [r, g, b] = hexToRgb(safeColor(color))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export interface ColorCheck {
  color: string
  /** Contrast against a white (day-mode) page. */
  onWhite: number
  /** Contrast against a black (Kindle night-mode) page. */
  onBlack: number
  /** True when the color clears {@link EINK_MIN_CONTRAST} on both. */
  ok: boolean
  /** Which side fails, when `ok` is false. */
  fails: "light" | "dark" | "both" | null
}

/** Contrast-check one color against both page backgrounds. */
export function checkColor(color: string, min = EINK_MIN_CONTRAST): ColorCheck {
  const c = safeColor(color)
  const onWhite = contrastRatio(c, "#ffffff")
  const onBlack = contrastRatio(c, "#000000")
  const lightBad = onWhite < min
  const darkBad = onBlack < min
  return {
    color: c,
    onWhite,
    onBlack,
    ok: !lightBad && !darkBad,
    fails: lightBad && darkBad ? "both" : lightBad ? "light" : darkBad ? "dark" : null,
  }
}

export type ColorScope = "rarity" | "keyword" | "percent"

export interface AuditEntry {
  scope: ColorScope
  /** Index within `config.rarities` / `config.keywords`, or -1 for percent. */
  index: number
  /** `low` | `mid` | `high` for percent stops, otherwise the group key. */
  key: string
  label: string
  check: ColorCheck
}

export interface GreyscaleClash {
  aLabel: string
  bLabel: string
  delta: number
}

export interface StyleAudit {
  entries: AuditEntry[]
  failing: AuditEntry[]
  clashes: GreyscaleClash[]
  /** True when the panel paints a solid fill (a grey smear in night mode). */
  solidPanel: boolean
}

/**
 * Does the panel paint a visible fill? Kindle night mode renders ANY block
 * background as a grey smear behind the text — even a faint 8% tint — so
 * anything that isn't fully transparent counts.
 */
function hasVisibleFill(background: string): boolean {
  const v = safePanelColor(background, DEFAULT_STAT_SHEET.background).toLowerCase()
  if (v === "transparent" || v === "inherit") return false
  const alpha = v.startsWith("rgba(") ? parseFloat(v.split(",")[3] ?? "1") : 1
  return Number.isFinite(alpha) ? alpha > 0 : true
}

/** Audit every configured color for e-ink / night-mode legibility. */
export function auditStyleConfig(config: StyleConfig, min = EINK_MIN_CONTRAST): StyleAudit {
  const entries: AuditEntry[] = []
  config.rarities.forEach((t, index) =>
    entries.push({
      scope: "rarity",
      index,
      key: t.key,
      label: t.label || t.key,
      check: checkColor(t.style.color, min),
    }),
  )
  config.keywords.forEach((g, index) =>
    entries.push({
      scope: "keyword",
      index,
      key: g.key,
      label: g.label || g.key,
      check: checkColor(g.style.color, min),
    }),
  )
  if (config.percent.enabled)
    for (const k of ["low", "mid", "high"] as const)
      entries.push({
        scope: "percent",
        index: -1,
        key: k,
        label: `Percent ${k}`,
        check: checkColor(config.percent[k], min),
      })

  const clashes: GreyscaleClash[] = []
  for (let i = 0; i < config.rarities.length - 1; i++) {
    const a = config.rarities[i]
    const b = config.rarities[i + 1]
    const delta = Math.abs(perceivedLuminance(a.style.color) - perceivedLuminance(b.style.color))
    if (delta < EINK_MIN_GREY_GAP)
      clashes.push({ aLabel: a.label || a.key, bLabel: b.label || b.key, delta })
  }

  return {
    entries,
    failing: entries.filter((e) => !e.check.ok),
    clashes,
    solidPanel: hasVisibleFill(config.statSheet.background),
  }
}

// ── HSL nudging ("Fix for e-ink") ────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const hex = (v: number) => clampByte(v * 255).toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Convert a hex color to HSL (all components 0..1). Exported for tests. */
export function hexToHsl(color: string): [number, number, number] {
  const [r, g, b] = hexToRgb(safeColor(color))
  return rgbToHsl(r, g, b)
}

/**
 * Nudge a color's lightness (hue and saturation preserved) toward the mid-range
 * until it clears {@link EINK_MIN_CONTRAST} against both a white and a black
 * page. Returns the color unchanged when it already passes.
 */
export function fixColorForEink(color: string, min = EINK_MIN_CONTRAST): string {
  const hex = safeColor(color)
  if (checkColor(hex, min).ok) return hex
  const [h, s, l] = hexToHsl(hex)
  // Walk outward from the original lightness so the result stays as close to the
  // author's intent as possible.
  for (let step = 1; step <= 100; step++) {
    for (const cand of [l - step / 100, l + step / 100]) {
      if (cand < 0 || cand > 1) continue
      const next = hslToHex(h, s, cand)
      if (checkColor(next, min).ok) return next
    }
  }
  return FALLBACK_COLOR
}

/**
 * Non-destructive "Fix for e-ink": a copy of `config` with every failing color
 * nudged into the legible band (glows re-tinted to match).
 */
export function fixConfigForEink(config: StyleConfig, min = EINK_MIN_CONTRAST): StyleConfig {
  const fixStyle = (s: TextStyle): TextStyle => {
    const color = fixColorForEink(s.color, min)
    return { ...s, color, glow: s.glow ? glowFor(color) : "" }
  }
  return {
    ...cloneConfig(config),
    rarities: config.rarities.map((t) => ({ ...structuredClone(t), style: fixStyle(t.style) })),
    keywords: config.keywords.map((g) => ({ ...structuredClone(g), style: fixStyle(g.style) })),
    percent: {
      ...config.percent,
      low: fixColorForEink(config.percent.low, min),
      mid: fixColorForEink(config.percent.mid, min),
      high: fixColorForEink(config.percent.high, min),
    },
  }
}

/** Switch the stat-sheet panel to border-only (no night-mode grey smear). */
export function borderOnlyPanel(config: StyleConfig): StyleConfig {
  return {
    ...cloneConfig(config),
    statSheet: {
      ...config.statSheet,
      background: "transparent",
      border: safePanelColor(config.statSheet.border, DEFAULT_STAT_SHEET.border),
    },
  }
}
