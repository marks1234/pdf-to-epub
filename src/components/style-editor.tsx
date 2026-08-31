import { useEffect, useMemo, useState } from "react"
import {
  Check,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
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
import { blocksToHtml, type Block } from "@/lib/reconstruct"
import {
  DEFAULT_STYLE_CONFIG,
  PALETTE,
  cloneConfig,
  createStyler,
  glowFor,
  type KeywordGroup,
  type RarityTier,
  type StyleConfig,
} from "@/lib/styles"
import type { StyleProfile } from "@/lib/storage"

type Tab = "rarities" | "keywords" | "percent" | "profiles"

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

/** A compact color control: native picker + the curated palette. */
function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="size-6 shrink-0 rounded-md border shadow-sm"
        style={{ background: value }}
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
              value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888"}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border bg-transparent"
            />
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 flex-1 text-xs"
            />
          </div>
        </div>
      )}
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

  // Re-seed the draft whenever a different EPUB is opened.
  useEffect(() => {
    if (open) setConfig(cloneConfig(initialConfig ?? DEFAULT_STYLE_CONFIG))
  }, [open, initialConfig])

  const preview = useMemo(() => previewHtml(config), [config])

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

  const tabs: { id: Tab; label: string; icon: typeof Sparkles }[] = [
    { id: "rarities", label: "Rarities", icon: Sparkles },
    { id: "keywords", label: "Keywords", icon: Wand2 },
    { id: "percent", label: "Percent & panel", icon: Palette },
    { id: "profiles", label: "Profiles", icon: Save },
  ]

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
                            style: { color: "#7c3aed", gradient: [], glow: "", bold: true },
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
                    <div className="mt-2 flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">Background</span>
                      <ColorField
                        value={config.statSheet.background.startsWith("#") ? config.statSheet.background : "#80808014"}
                        onChange={(background) => setConfig((c) => ({ ...c, statSheet: { ...c.statSheet, background } }))}
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
                  </div>
                </div>
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
                  </div>
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
          <span className="mr-auto self-center text-xs text-muted-foreground">
            {busy ? "Applying…" : hint}
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
