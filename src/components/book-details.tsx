import { useEffect, useRef, useState } from "react"
import { ChevronDown, ImageIcon, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { kindleSeriesTitle } from "@/lib/titles"
import { cn } from "@/lib/utils"

/** The extra metadata a book can carry beyond title and author. */
export interface BookDetailsValue {
  series: string
  /** 1-based position in the series; null when the field is empty. */
  seriesIndex: number | null
  /** BCP-47 tag; empty means "en". */
  language: string
  description: string
  cover: Blob | null
  /** Fold series + index into `dc:title` so Kindle groups sideloads. */
  kindleSeriesTitle: boolean
}

/** Tags common enough in web-novel translations to be worth suggesting. */
const LANGUAGE_TAGS = ["en", "es", "de", "fr", "pt", "ru", "ja", "ko", "zh"]

const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"]

/** Formats whose alpha channel Kindle renders as black; worth a nudge, not a block. */
const ALPHA_RISK_TYPES = ["image/png", "image/webp"]

interface BookDetailsProps {
  value: BookDetailsValue
  onChange: (patch: Partial<BookDetailsValue>) => void
  /** The plain title, used for the Kindle series-title preview. */
  title: string
  disabled?: boolean
}

/**
 * Optional book metadata, collapsed by default: most conversions never need it,
 * but a sideloaded EPUB without a cover or a language tag is exactly what shows
 * up on a Kindle as "Docs" in the wrong font.
 */
export function BookDetails({
  value,
  onChange,
  title,
  disabled,
}: BookDetailsProps) {
  const [open, setOpen] = useState(false)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [coverError, setCoverError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Object URLs leak until revoked, and the cover changes as often as the user
  // wants it to.
  useEffect(() => {
    if (!value.cover) {
      setCoverUrl(null)
      return
    }
    const url = URL.createObjectURL(value.cover)
    setCoverUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [value.cover])

  const acceptCover = (file: File | undefined) => {
    if (!file) return
    if (!COVER_TYPES.includes(file.type)) {
      setCoverError("Covers must be a JPEG, PNG or WebP image.")
      return
    }
    setCoverError(null)
    onChange({ cover: file })
  }

  const hasSeries = value.series.trim().length > 0 && value.seriesIndex != null
  const alphaRisk =
    !!value.cover && ALPHA_RISK_TYPES.includes(value.cover.type)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="shrink-0 rounded-lg border"
    >
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm font-medium transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Book details"
      >
        <span className="flex items-center gap-2">
          Book details
          <span className="text-xs font-normal text-muted-foreground">
            series, language, cover
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 border-t p-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          <div className="space-y-1.5">
            <Label htmlFor="series">Series</Label>
            <Input
              id="series"
              value={value.series}
              placeholder="Quest Academy"
              disabled={disabled}
              onChange={(e) => onChange({ series: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-index">Series index</Label>
            <Input
              id="series-index"
              type="number"
              min={1}
              step={1}
              value={value.seriesIndex ?? ""}
              placeholder="1"
              disabled={disabled}
              onChange={(e) => {
                const n = e.target.valueAsNumber
                onChange({
                  seriesIndex: Number.isFinite(n) && n >= 1 ? Math.floor(n) : null,
                })
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="language">Language</Label>
          <Input
            id="language"
            value={value.language}
            placeholder="en"
            list="language-tags"
            disabled={disabled}
            onChange={(e) => onChange({ language: e.target.value })}
          />
          <datalist id="language-tags">
            {LANGUAGE_TAGS.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={2}
            value={value.description}
            placeholder="A short blurb, shown in the reader's library."
            disabled={disabled}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>

        {/* Cover */}
        <div className="space-y-1.5">
          <Label>Cover</Label>
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a cover image"
            onClick={() => !disabled && fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                if (!disabled) fileInput.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (!disabled) acceptCover(e.dataTransfer.files[0])
            }}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md border-2 border-dashed p-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              dragOver ? "border-primary bg-accent" : "border-input",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt="Cover preview"
                className="h-16 w-12 shrink-0 rounded-sm border object-cover"
              />
            ) : (
              <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-sm border bg-muted text-muted-foreground">
                <ImageIcon className="size-5" />
              </div>
            )}
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {value.cover
                ? "Cover set — click to replace."
                : "Drop an image here, or click to choose. JPEG, PNG or WebP."}
            </p>
            {value.cover && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="Remove cover"
                onClick={(e) => {
                  e.stopPropagation()
                  setCoverError(null)
                  onChange({ cover: null })
                  if (fileInput.current) fileInput.current.value = ""
                }}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={COVER_TYPES.join(",")}
            className="hidden"
            onChange={(e) => acceptCover(e.target.files?.[0])}
          />
          <p className="text-xs text-muted-foreground">
            JPEG, sRGB, ≥1200px long edge works best on Kindle.
          </p>
          {coverError && (
            <p className="text-xs font-medium text-destructive">{coverError}</p>
          )}
          {alphaRisk && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              PNG and WebP can carry an alpha channel, which some Kindles render
              as black. A flattened JPEG is safer.
            </p>
          )}
        </div>

        {/* Kindle series-sort title */}
        {hasSeries && (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-2.5">
            <Label
              htmlFor="kindle-series-title"
              className="items-start text-xs font-medium"
            >
              <Checkbox
                id="kindle-series-title"
                checked={value.kindleSeriesTitle}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange({ kindleSeriesTitle: checked === true })
                }
                className="mt-0.5"
              />
              <span>
                Kindle series title — Kindle ignores series metadata for
                sideloads, so fold it into the title to keep the volumes together.
              </span>
            </Label>
            {value.kindleSeriesTitle && (
              <p className="truncate pl-6 text-xs text-muted-foreground">
                Title becomes{" "}
                <span className="font-medium text-foreground">
                  {kindleSeriesTitle(
                    value.series,
                    value.seriesIndex ?? 1,
                    title || "Merged Document",
                  )}
                </span>
              </p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
