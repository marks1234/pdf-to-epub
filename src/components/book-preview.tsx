import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Moon,
  Eye,
  Sun,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { blocksToHtml, escapeHtml } from "@/lib/reconstruct"
import { createStyler, type StyleConfig } from "@/lib/styles"
import type { Chapter } from "@/lib/pdf-to-epub"

/** Page colors for each reading mode, matched to the style editor's preview. */
const PAGE = {
  light: { bg: "#ffffff", fg: "#1a1a1a", rule: "#00000022" },
  dark: { bg: "#16181d", fg: "#e6e6e6", rule: "#ffffff26" },
} as const

type Mode = keyof typeof PAGE

/**
 * Render one chapter exactly the way the EPUB does — same `blocksToHtml`, same
 * compiled stylesheet — wrapped in the serif page an e-reader would show it on.
 */
function chapterHtml(chapter: Chapter, config: StyleConfig, mode: Mode): string {
  const styler = createStyler(config)
  const page = PAGE[mode]
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0}
    body{
      font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.65;
      background:${page.bg};color:${page.fg};
      padding:32px 28px 64px;max-width:38em;margin:0 auto;
    }
    h1{font-size:1.35em;line-height:1.3;margin:0 0 1.2em;font-weight:600}
    p{margin:0 0 1em}
    hr.scene-break{border:0;border-top:1px solid ${page.rule};margin:2em auto;width:35%}
    ${styler.css}
  </style></head><body>
    <h1>${escapeHtml(chapter.title)}</h1>
    ${blocksToHtml(chapter.blocks, styler)}
  </body></html>`
}

export interface BookPreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Identity of the output being read; re-loads the chapters when it changes. */
  outputId: string
  /** Shown in the dialog header. */
  filename: string
  title: string
  /** The style the EPUB was built with, so the preview matches the real file. */
  config: StyleConfig
  /** Pulls the stored chapters in on demand (see `useOutputs().loadChapters`). */
  loadChapters: (id: string) => Promise<Chapter[] | undefined>
  /** Reading mode to start in — normally the app's own resolved theme. */
  initialDark?: boolean
}

/**
 * An in-app reader for a stored EPUB: chapter list on the left, the chapter
 * rendered on the right in an iframe, in the book's own style.
 *
 * The chapters are only fetched while the dialog is open — the history listing
 * deliberately omits them, and a book can be several megabytes of text.
 */
export function BookPreview({
  open,
  onOpenChange,
  outputId,
  filename,
  title,
  config,
  loadChapters,
  initialDark = false,
}: BookPreviewProps) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<Mode>(initialDark ? "dark" : "light")

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(null)
    setChapters(null)
    setIndex(0)
    loadChapters(outputId)
      .then((loaded) => {
        if (!active) return
        setChapters(loaded ?? [])
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e.message : "Could not load this book's text.")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, outputId, loadChapters])

  const chapter = chapters?.[index]
  const html = useMemo(
    () => (chapter ? chapterHtml(chapter, config, mode) : ""),
    [chapter, config, mode],
  )

  const step = useCallback(
    (delta: number) =>
      setIndex((i) => Math.min(Math.max(i + delta, 0), (chapters?.length ?? 1) - 1)),
    [chapters],
  )

  const count = chapters?.length ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90svh] max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="size-4" /> Preview
          </DialogTitle>
          <DialogDescription className="truncate">
            {title}
            {filename !== title && ` — ${filename}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden sm:grid-cols-[220px_1fr]">
          {/* Chapter list */}
          <nav
            aria-label="Chapters"
            className="hidden min-h-0 flex-col border-r sm:flex"
          >
            <p className="shrink-0 px-3 py-2 text-xs font-medium text-muted-foreground">
              {count} chapter{count === 1 ? "" : "s"}
            </p>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {chapters?.map((c, i) => (
                <li key={`${c.title}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={i === index ? "true" : undefined}
                    className={cn(
                      "w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      i === index
                        ? "bg-secondary font-medium text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                    title={c.title}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Reading pane */}
          <div className="flex min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => step(-1)}
                disabled={index === 0 || count === 0}
              >
                <ChevronLeft className="size-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => step(1)}
                disabled={index >= count - 1}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
              <span className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">
                {chapter ? `${chapter.title} · ${index + 1} of ${count}` : ""}
              </span>
              <div
                className="flex shrink-0 items-center gap-1 rounded-md border p-0.5"
                role="group"
                aria-label="Reading mode"
              >
                {(["light", "dark"] as const).map((m) => (
                  <Button
                    key={m}
                    variant={mode === m ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-pressed={mode === m}
                    aria-label={`${m === "light" ? "Light" : "Dark"} page`}
                    title={`${m === "light" ? "Light" : "Dark"} page`}
                    onClick={() => setMode(m)}
                  >
                    {m === "light" ? (
                      <Sun className="size-3.5" />
                    ) : (
                      <Moon className="size-3.5" />
                    )}
                  </Button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {loading ? (
                <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading the book…
                </p>
              ) : error ? (
                <p
                  role="alert"
                  className="flex h-full items-center justify-center gap-2 px-6 text-center text-sm text-destructive"
                >
                  <AlertTriangle className="size-4 shrink-0" />
                  {error}
                </p>
              ) : chapter ? (
                <iframe
                  title={`Preview of ${chapter.title}`}
                  srcDoc={html}
                  sandbox=""
                  className="size-full border-0"
                />
              ) : (
                <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  No stored text for this book.
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
