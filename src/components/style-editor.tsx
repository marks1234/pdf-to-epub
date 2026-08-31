import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  Contrast,
  Download,
  Info,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { downloadBlob } from "@/lib/download"
import { blocksToHtml, type Block } from "@/lib/reconstruct"
import {
  DEFAULT_STYLE_CONFIG,
  EINK_MIN_CONTRAST,
  PALETTE,
  auditStyleConfig,
  borderOnlyPanel,
  cloneConfig,
  createStyler,
  fixConfigForEink,
  glowFor,
  normalizeHex,
  styleConfigFromJson,
  styleConfigToJson,
  type AuditEntry,
  type ColorCheck,
  type KeywordGroup,
  type RarityTier,
  type StyleConfig,
} from "@/lib/styles"
import type { StyleProfile } from "@/lib/storage"

type Tab = "rarities" | "keywords" | "percent" | "device" | "profiles"

/** A representative stat sheet used for the live preview. */
const PREVIEW_BLOCKS: Block[] = [
  { type: "p", text: "Mythical Soul Stealer [Set: 7/7]" },
  { type: "p", text: "Crafted Grade Mythic-Grade" },
  { type: "li", text: "[Common] Switcher has been killed." },
  { type: "li", text: "[Legendary] Blade of Dawn obtained." },
  { type: "li", text: "[Mythic] Guild: Athena [Suitability: Excellent]" },
  { type: "li", text: "Reactor: [4.9%] [9/180] [Recharging]" },
  { type: "li", text: "Soul Whips: [0.6% of 10%]" },
  { type: "li", text: "Set Maintenance [2.2% of 20%] [Not Found]" },
  { type: "p", text: "Build Quality Flawless" },
  { type: "p", text: "Build Condition 100%" },
]

function previewHtml(config: StyleConfig): string {
  const styler = createStyler(config)
  const body = blocksToHtml(PREVIEW_BLOCKS, styler)
  const panel = (bg: string, fg: string, label: string) =>
    `<div style="background:${bg};color:${fg};padding:10px 14px;border-radius:10px;margin-bottom:10px;">
      <div style="font:600 10px sans-serif;letter-spacing:.08em;text-transform:uppercase;opacity:.5;margin-bottom:6px">${label}</div>
      ${body}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0}body{font-family:Georgia,serif;font-size:14px;line-height:1.5;padding:8px}
    ${styler.css}
  </style></head><body>
    ${panel("#ffffff", "#1a1a1a", "Light")}
    ${panel("#16181d", "#e6e6e6", "Dark")}
  </body></html>`
}

/**
 * A compact color control: native picker + the curated palette + a free-text
 * hex box. The free text is kept in local state while typing and only committed
 * once {@link normalizeHex} accepts it — junk like `red` must never reach the
 * config, or it ends up as `rgb(NaN,NaN,NaN)` in the shipped EPUB.
 */
function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)

  // Re-sync when the committed value changes from elsewhere (palette, reset…).
  useEffect(() => setDraft(value), [value])

  const draftValid = normalizeHex(draft) !== null
  const swatch = normalizeHex(value) ?? "#888888"

  const commit = (raw: string) => {
    const hex = normalizeHex(raw)
    if (hex) onChange(hex)
    else setDraft(value)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="size-6 shrink-0 rounded-md border shadow-sm"
        style={{ background: swatch }}
        aria-label="Pick color"
      />
      {open && (
        <div className="absolute left-0 top-7 z-10 w-44 rounded-lg border bg-popover p-2 shadow-md">
          <div className="grid grid-cols-6 gap-1">
            {PALETTE.map((p) => (
              <button
                key={p.color}
                type="button"
                title={p.name}
                onClick={() => {
                  onChange(p.color)
                  setOpen(false)
                }}
                className="flex size-5 items-center justify-center rounded"
                style={{ background: p.color }}
              >
                {p.color.toLowerCase() === value.toLowerCase() && (
                  <Check className="size-3 text-white" />
                )}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="color"
              value={swatch}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border bg-transparent"
            />
            <Input
              value={draft}
              spellCheck={false}
              aria-invalid={!draftValid}
              title={draftValid ? undefined : "Enter a hex color, e.g. #c92a2a or #abc"}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit((e.target as HTMLInputElement).value)
                if (e.key === "Escape") setDraft(value)
              }}
              className={cn(
                "h-7 flex-1 text-xs",
                !draftValid && "border-destructive text-destructive",
              )}
            />
          </div>
          {!draftValid && (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-destructive">
              <AlertTriangle className="size-3 shrink-0" /> Not a hex color — #rgb or
              #rrggbb
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Why a color is unsafe, in the words of an actual e-reader. */
function contrastReason(check: ColorCheck): string {
  const nums = `contrast ${check.onWhite.toFixed(1)}:1 on white, ${check.onBlack.toFixed(1)}:1 on black`
  if (check.fails === "light")
    return `Too light — washes out on a white page (${nums}).`
  if (check.fails === "dark")
    return `Too dark — nearly invisible in Kindle night mode, which forces a black page (${nums}).`
  return `Barely visible on either page background (${nums}).`
}

/** The small inline "this color won't survive an e-reader" marker. */
function ContrastWarning({ check }: { check: ColorCheck | undefined }) {
  if (!check || check.ok) return null
  return (
    <span
      role="img"
      aria-label={`Device safety warning: ${contrastReason(check)}`}
      title={contrastReason(check)}
      className="flex shrink-0 items-center text-amber-600 dark:text-amber-500"
    >
      <AlertTriangle className="size-3.5" />
    </span>
  )
}

/** Night-mode grey-smear hint for a filled stat-sheet panel. */
function PanelFillHint({ onFix }: { onFix: () => void }) {
  return (
    <div className="mt-3 flex items-start gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-xs">
      <Info className="mt-0.5 size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
      <div className="flex-1">
        <p>
          The panel paints a background fill. Kindle night mode forces a black page
          and renders block fills as a grey smear behind the text — a border-only
          panel reads cleanly in both modes.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onFix}>
          Use border-only panel
        </Button>
      </div>
    </div>
  )
}

/** The "Device safety" tab: night-mode contrast, greyscale clashes, panel fill. */
function DeviceSafetyPanel({
  audit,
  onFixColors,
  onBorderOnly,
}: {
  audit: ReturnType<typeof auditStyleConfig>
  onFixColors: () => void
  onBorderOnly: () => void
}) {
  const { entries, failing, clashes } = audit
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start gap-2 rounded-md border p-2">
        <Contrast className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="font-medium">
            {failing.length === 0
              ? `All ${entries.length} colors stay legible in both page modes.`
              : `${failing.length} of ${entries.length} colors may vanish on an e-reader.`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every color is checked against a white page and against the black page
            Kindle night mode forces (no per-book override, no{" "}
            <code>prefers-color-scheme</code>). Anything under{" "}
            {EINK_MIN_CONTRAST}:1 on either side is flagged.
          </p>
        </div>
        {failing.length > 0 && (
          <Button size="sm" variant="outline" onClick={onFixColors}>
            <Wand2 className="size-3.5" /> Fix for e-ink
          </Button>
        )}
      </div>

      {failing.length > 0 && (
        <ul className="space-y-1">
          {failing.map((e) => (
            <li
              key={`${e.scope}-${e.key}`}
              className="flex items-center gap-2 rounded-md border p-1.5 text-xs"
            >
              <span
                className="size-4 shrink-0 rounded border"
                style={{ background: e.check.color }}
              />
              <span className="w-28 shrink-0 truncate font-medium">{e.label}</span>
              <code className="shrink-0 text-muted-foreground">{e.check.color}</code>
              <span className="flex-1 text-muted-foreground">
                {contrastReason(e.check)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t pt-3">
        <p className="font-medium">Monochrome e-ink</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Basic Kindles and Kobos flatten color to greyscale — two tiers separated
          only by hue become the same grey. Only perceived luminance survives.
        </p>
        {clashes.length === 0 ? (
          <p className="mt-2 text-xs">Adjacent rarity tiers are all distinguishable.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {clashes.map((c) => (
              <li key={`${c.aLabel}-${c.bLabel}`} className="flex items-center gap-2 text-xs">
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                <span>
                  <strong>{c.aLabel}</strong> and <strong>{c.bLabel}</strong> differ by
                  only {(c.delta * 100).toFixed(1)}% brightness — identical in
                  greyscale.
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t pt-3">
        <p className="font-medium">Stat-sheet panel</p>
        {audit.solidPanel ? (
          <PanelFillHint onFix={onBorderOnly} />
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Border-only — no background fill to smear in night mode.
          </p>
        )}
      </div>
    </div>
  )
}

function wordsToText(words: string[]): string {
  return words.join(", ")
}
function textToWords(text: string): string[] {
  return text
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
}

export interface StyleEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename: string
  initialConfig?: StyleConfig
  canRestyle: boolean
  profiles: StyleProfile[]
  busy: boolean
  onApply: (config: StyleConfig) => void
  onSaveProfile: (name: string, config: StyleConfig) => void
  onDeleteProfile: (id: string) => void
  /** Label for the confirm button; defaults to the per-EPUB wording. */
  applyLabel?: string
  /** Footer hint shown while idle; defaults to the per-EPUB wording. */
  hint?: string
}

export function StyleEditor({
  open,
  onOpenChange,
  filename,
  initialConfig,
  canRestyle,
  profiles,
  busy,
  onApply,
  onSaveProfile,
  onDeleteProfile,
  applyLabel = "Apply to EPUB",
  hint = "Changes apply to this EPUB.",
}: StyleEditorProps) {
  const [config, setConfig] = useState<StyleConfig>(() =>
    cloneConfig(initialConfig ?? DEFAULT_STYLE_CONFIG),
  )
  const [tab, setTab] = useState<Tab>("rarities")
  const [profileName, setProfileName] = useState("")
  const [importError, setImportError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  // Re-seed the draft whenever a different EPUB is opened.
  useEffect(() => {
    if (open) setConfig(cloneConfig(initialConfig ?? DEFAULT_STYLE_CONFIG))
  }, [open, initialConfig])

  const preview = useMemo(() => previewHtml(config), [config])
  const audit = useMemo(() => auditStyleConfig(config), [config])
  const checkFor = (scope: AuditEntry["scope"], key: string): ColorCheck | undefined =>
    audit.entries.find((e) => e.scope === scope && e.key === key)?.check

  const patchTier = (i: number, patch: Partial<RarityTier>) =>
    setConfig((c) => ({
      ...c,
      rarities: c.rarities.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    }))

  const patchKeyword = (i: number, patch: Partial<KeywordGroup>) =>
    setConfig((c) => ({
      ...c,
      keywords: c.keywords.map((g, j) => (j === i ? { ...g, ...patch } : g)),
    }))

  const tabs: { id: Tab; label: string; icon: typeof Sparkles; badge?: number }[] = [
    { id: "rarities", label: "Rarities", icon: Sparkles },
    { id: "keywords", label: "Keywords", icon: Wand2 },
    { id: "percent", label: "Percent & panel", icon: Palette },
    {
      id: "device",
      label: "Device safety",
      icon: Contrast,
      badge: audit.failing.length,
    },
    { id: "profiles", label: "Profiles", icon: Save },
  ]

  const handleImport = async (file: File | undefined) => {
    setImportError(null)
    setImportNote(null)
    if (!file) return
    const result = styleConfigFromJson(await file.text())
    if (!result.ok) {
      setImportError(`${file.name}: ${result.error}`)
      return
    }
    const name = file.name.replace(/\.json$/i, "").trim() || "Imported profile"
    setConfig(result.config)
    onSaveProfile(name, result.config)
    setImportNote(`Imported “${name}” — loaded into the editor and saved as a profile.`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="size-4" /> Style editor
          </DialogTitle>
          <DialogDescription className="truncate">
            {filename}
            {!canRestyle && " — converted before styling support; re-convert to enable full re-styling"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[1fr_320px]">
          {/* Controls */}
          <div className="flex min-h-0 flex-col border-r">
            <div className="flex shrink-0 gap-1 border-b px-3 py-2">
              {tabs.map((t) => (
                <Button
                  key={t.id}
                  variant={tab === t.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setTab(t.id)}
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                  {!!t.badge && (
                    <span
                      className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-500"
                      title={`${t.badge} color${t.badge === 1 ? "" : "s"} may be invisible on an e-reader`}
                    >
                      {t.badge}
                    </span>
                  )}
                </Button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {tab === "rarities" && (
                <div className="space-y-1.5">
                  {config.rarities.map((t, i) => (
                    <div
                      key={t.key}
                      className="flex items-center gap-2 rounded-md border p-1.5"
                    >
                      <ColorField
                        value={t.style.color}
                        onChange={(color) =>
                          patchTier(i, {
                            style: {
                              ...t.style,
                              color,
                              // keep the glow tinted to the new color
                              glow: t.style.glow ? glowFor(color) : "",
                            },
                          })
                        }
                      />
                      <span className="w-24 shrink-0 truncate text-sm font-medium">
                        {t.label}
                      </span>
                      <ContrastWarning check={checkFor("rarity", t.key)} />
                      <Input
                        value={wordsToText(t.words)}
                        onChange={(e) => patchTier(i, { words: textToWords(e.target.value) })}
                        className="h-7 flex-1 text-xs"
                        placeholder="words…"
                      />
                      <label
                        className="flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs"
                        title="Adds a soft glow + heavier weight (Kindle-safe)"
                      >
                        <input
                          type="checkbox"
                          checked={!!t.style.glow}
                          onChange={(e) =>
                            patchTier(i, {
                              style: {
                                ...t.style,
                                glow: e.target.checked ? glowFor(t.style.color) : "",
                              },
                            })
                          }
                        />
                        glow
                      </label>
                    </div>
                  ))}
                </div>
              )}

              {tab === "keywords" && (
                <div className="space-y-1.5">
                  {config.keywords.map((g, i) => (
                    <div key={g.key} className="flex items-center gap-2 rounded-md border p-1.5">
                      <ColorField
                        value={g.style.color}
                        onChange={(color) => patchKeyword(i, { style: { ...g.style, color } })}
                      />
                      <ContrastWarning check={checkFor("keyword", g.key)} />
                      <Input
                        value={g.label}
                        onChange={(e) => patchKeyword(i, { label: e.target.value })}
                        className="h-7 w-32 shrink-0 text-xs font-medium"
                      />
                      <Input
                        value={wordsToText(g.words)}
                        onChange={(e) => patchKeyword(i, { words: textToWords(e.target.value) })}
                        className="h-7 flex-1 text-xs"
                        placeholder="words…"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setConfig((c) => ({
                            ...c,
                            keywords: c.keywords.filter((_, j) => j !== i),
                          }))
                        }
                        aria-label="Remove group"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setConfig((c) => ({
                        ...c,
                        keywords: [
                          ...c.keywords,
                          {
                            key: `custom-${c.keywords.length + 1}-${Math.floor(Date.now() % 100000)}`,
                            label: "New rule",
                            words: [],
                            // No gradient field: a linear-gradient anywhere in the
                            // book CSS disables Kindle Enhanced Typesetting.
                            style: { color: "#7c3aed", glow: "", bold: true },
                          },
                        ],
                      }))
                    }
                  >
                    <Plus className="size-3.5" /> Add keyword rule
                  </Button>
                </div>
              )}

              {tab === "percent" && (
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs">Percentage gradient (low → high)</Label>
                    <div className="mt-2 flex items-center gap-3">
                      <ColorField value={config.percent.low} onChange={(low) => setConfig((c) => ({ ...c, percent: { ...c.percent, low } }))} />
                      <ColorField value={config.percent.mid} onChange={(mid) => setConfig((c) => ({ ...c, percent: { ...c.percent, mid } }))} />
                      <ColorField value={config.percent.high} onChange={(high) => setConfig((c) => ({ ...c, percent: { ...c.percent, high } }))} />
                      <ContrastWarning
                        check={(["low", "mid", "high"] as const)
                          .map((k) => checkFor("percent", k))
                          .find((c) => c && !c.ok)}
                      />
                      {/* Editor-only swatch. This gradient is a React inline
                          style in the app UI — it is never serialized into the
                          EPUB stylesheet (which must stay gradient-free). */}
                      <div
                        className="h-4 flex-1 rounded-full"
                        style={{ background: `linear-gradient(90deg, ${config.percent.low}, ${config.percent.mid}, ${config.percent.high})` }}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.percent.pairMax}
                      onChange={(e) => setConfig((c) => ({ ...c, percent: { ...c.percent, pairMax: e.target.checked } }))}
                    />
                    Treat the second of a close pair as the max (green)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.percent.enabled}
                      onChange={(e) => setConfig((c) => ({ ...c, percent: { ...c.percent, enabled: e.target.checked } }))}
                    />
                    Color percentages
                  </label>
                  <div className="border-t pt-3">
                    <Label className="text-xs">Stat-sheet panel</Label>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-muted-foreground">Background</span>
                      <ColorField
                        value={normalizeHex(config.statSheet.background) ?? "#808080"}
                        onChange={(background) => setConfig((c) => ({ ...c, statSheet: { ...c.statSheet, background } }))}
                      />
                      <span className="text-muted-foreground">Border</span>
                      <ColorField
                        value={normalizeHex(config.statSheet.border) ?? "#808080"}
                        onChange={(border) => setConfig((c) => ({ ...c, statSheet: { ...c.statSheet, border } }))}
                      />
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={config.statSheet.rounded}
                          onChange={(e) => setConfig((c) => ({ ...c, statSheet: { ...c.statSheet, rounded: e.target.checked } }))}
                        />
                        Rounded corners
                      </label>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Current fill: <code>{config.statSheet.background}</code> · border:{" "}
                      <code>{config.statSheet.border}</code>
                    </p>
                    {audit.solidPanel && <PanelFillHint onFix={() => setConfig(borderOnlyPanel)} />}
                  </div>
                </div>
              )}

              {tab === "device" && (
                <DeviceSafetyPanel
                  audit={audit}
                  onFixColors={() => setConfig((c) => fixConfigForEink(c))}
                  onBorderOnly={() => setConfig(borderOnlyPanel)}
                />
              )}

              {tab === "profiles" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Profile name…"
                      className="h-8 flex-1 text-sm"
                    />
                    <Button
                      size="sm"
                      disabled={!profileName.trim()}
                      onClick={() => {
                        onSaveProfile(profileName.trim(), config)
                        setProfileName("")
                      }}
                    >
                      <Save className="size-3.5" /> Save current
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => importRef.current?.click()}
                    >
                      <Upload className="size-3.5" /> Import…
                    </Button>
                    <input
                      ref={importRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(e) => {
                        void handleImport(e.target.files?.[0])
                        e.target.value = ""
                      }}
                    />
                  </div>
                  {importError && (
                    <p
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
                    >
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {importError}
                    </p>
                  )}
                  {importNote && (
                    <p className="flex items-start gap-2 rounded-md border p-2 text-xs text-muted-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0" />
                      {importNote}
                    </p>
                  )}
                  {profiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No saved profiles yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {profiles.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 rounded-md border p-1.5">
                          <span className="flex-1 truncate text-sm">{p.name}</span>
                          <Button variant="outline" size="sm" onClick={() => setConfig(cloneConfig(p.config))}>
                            Load
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Export ${p.name}`}
                            title="Export as .json"
                            onClick={() =>
                              downloadBlob(
                                new Blob([styleConfigToJson(p.config)], {
                                  type: "application/json",
                                }),
                                `${p.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "style-profile"}.json`,
                                "application/json",
                              )
                            }
                          >
                            <Download className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => onDeleteProfile(p.id)} aria-label="Delete profile">
                            <Trash2 className="size-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t px-3 py-2">
              <Button variant="ghost" size="sm" onClick={() => setConfig(cloneConfig(DEFAULT_STYLE_CONFIG))}>
                <RotateCcw className="size-3.5" /> Reset to defaults
              </Button>
            </div>
          </div>

          {/* Live preview */}
          <div className="flex min-h-0 flex-col bg-muted/30">
            <div className="shrink-0 px-3 py-2 text-xs font-medium text-muted-foreground">
              Live preview
            </div>
            <iframe
              title="Style preview"
              srcDoc={preview}
              className={cn("min-h-0 flex-1 border-0")}
            />
          </div>
        </div>

        <DialogFooter>
          <span className="mr-auto flex items-center gap-3 self-center text-xs text-muted-foreground">
            {busy ? "Applying…" : hint}
            {!busy && audit.failing.length > 0 && (
              <button
                type="button"
                onClick={() => setTab("device")}
                className="flex items-center gap-1 text-amber-700 underline-offset-2 hover:underline dark:text-amber-500"
              >
                <AlertTriangle className="size-3.5" />
                {audit.failing.length} color{audit.failing.length === 1 ? "" : "s"} may be
                invisible on an e-reader
              </button>
            )}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onApply(config)} disabled={busy || !canRestyle}>
            <Check className="size-4" /> {applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
