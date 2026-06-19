import { Fragment, useCallback, useMemo, useState } from "react"
import { useDropzone } from "react-dropzone"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  ArrowDownAZ,
  BookOpen,
  CheckCircle2,
  Loader2,
  Merge,
  TriangleAlert,
  Trash2,
  UploadCloud,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  SortableFileItem,
  type PdfItem,
} from "@/components/sortable-file-item"
import { cn } from "@/lib/utils"
import { mergePdfs } from "@/lib/merge-pdf"
import { pdfToEpub } from "@/lib/pdf-to-epub"
import { downloadBlob } from "@/lib/download"
import {
  analyzeSequence,
  extractNumber,
  formatNumberRanges,
  rangeBetween,
} from "@/lib/sequence"

/** Largest gap span we annotate inline; bigger gaps are only shown in the banner. */
const MAX_INLINE_GAP = 26

type Busy = "idle" | "merging" | "converting"

/** Natural, numeric-aware filename sort: "Chapter 2" < "Chapter 10". */
function byNaturalName(a: PdfItem, b: PdfItem): number {
  return a.file.name.localeCompare(b.file.name, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

export default function App() {
  const [items, setItems] = useState<PdfItem[]>([])
  const [title, setTitle] = useState("Merged Document")
  const [author, setAuthor] = useState("")
  const [busy, setBusy] = useState<Busy>("idle")
  const [error, setError] = useState<string | null>(null)

  const seq = useMemo(
    () => analyzeSequence(items.map((i) => i.file.name)),
    [items],
  )

  const sensors = useSensors(
    // A small distance threshold so clicks on the remove button aren't drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDrop = useCallback((accepted: File[]) => {
    setError(null)
    setItems((prev) => [
      ...prev,
      ...accepted.map((file) => ({ id: crypto.randomUUID(), file })),
    ])
  }, [])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    noClick: true,
    noKeyboard: true,
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.id === active.id)
      const newIndex = prev.findIndex((i) => i.id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id))

  const autoOrder = () =>
    setItems((prev) =>
      [...prev].sort((a, b) => {
        const na = extractNumber(a.file.name).num
        const nb = extractNumber(b.file.name).num
        if (na !== null && nb !== null && na !== nb) return na - nb
        return byNaturalName(a, b)
      }),
    )

  const clearAll = () => {
    setItems([])
    setError(null)
  }

  const handleMerge = async () => {
    setError(null)
    setBusy("merging")
    try {
      const bytes = await mergePdfs(items.map((i) => i.file))
      downloadBlob(bytes, `${title || "merged"}.pdf`, "application/pdf")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to merge PDFs.")
    } finally {
      setBusy("idle")
    }
  }

  const handleConvert = async () => {
    setError(null)
    setBusy("converting")
    try {
      const bytes = await mergePdfs(items.map((i) => i.file))
      const epub = await pdfToEpub(bytes, {
        title: title || "Merged Document",
        author: author || "Unknown",
      })
      downloadBlob(epub, `${title || "merged"}.epub`, "application/epub+zip")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to convert to EPUB.")
    } finally {
      setBusy("idle")
    }
  }

  const isBusy = busy !== "idle"
  const hasFiles = items.length > 0

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="shrink-0 border-b">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <BookOpen className="size-5" />
            PDF Merge &amp; EPUB
          </h1>
          <p className="text-sm text-muted-foreground">
            Combine PDFs and convert them to EPUB — everything runs locally in
            your browser. No uploads.
          </p>
        </div>
      </header>

      {/* Scrollable middle */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 px-4 py-4">
          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
              isDragActive ? "border-primary bg-accent" : "border-input",
            )}
          >
            <input {...getInputProps()} />
            <UploadCloud className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isDragActive ? "Drop the PDFs here…" : "Drag PDF files here"}
            </p>
            <Button variant="secondary" size="sm" onClick={open} type="button">
              Browse files
            </Button>
          </div>

          {/* Metadata */}
          <div className="grid shrink-0 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Merged Document"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="author">Author</Label>
              <Input
                id="author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Unknown"
              />
            </div>
          </div>

          {/* Toolbar */}
          {hasFiles && (
            <div className="flex shrink-0 items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {items.length} {items.length === 1 ? "file" : "files"} · drag to
                reorder
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={autoOrder}
                  disabled={isBusy}
                >
                  <ArrowDownAZ className="size-4" />
                  Auto-order
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAll}
                  disabled={isBusy}
                >
                  <Trash2 className="size-4" />
                  Clear all
                </Button>
              </div>
            </div>
          )}

          {/* Sequence / gap detection */}
          {seq.hasOrder &&
            (seq.missing.length > 0 || seq.duplicates.length > 0 ? (
              <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-0.5">
                  {seq.missing.length > 0 && (
                    <p>
                      Gap in sequence — missing{" "}
                      {(seq.label ?? "number").toLowerCase()}
                      {seq.missing.length > 1 ? "s" : ""}{" "}
                      <span className="font-semibold">
                        {formatNumberRanges(seq.missing)}
                      </span>
                      .
                    </p>
                  )}
                  {seq.duplicates.length > 0 && (
                    <p>
                      Duplicate{" "}
                      {(seq.label ?? "number").toLowerCase()}
                      {seq.duplicates.length > 1 ? "s" : ""}:{" "}
                      <span className="font-semibold">
                        {formatNumberRanges(seq.duplicates)}
                      </span>
                      .
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 className="size-4 shrink-0" />
                <p>
                  Sequence complete — {(seq.label ?? "items").toLowerCase()}{" "}
                  {seq.min}–{seq.max}, no gaps.
                </p>
              </div>
            ))}

          {/* Scrollable file list */}
          {hasFiles ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={items.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="divide-y">
                    {items.map((item, index) => {
                      const cur = seq.numbers[index]
                      const next = seq.numbers[index + 1]
                      const gap =
                        seq.hasOrder &&
                        cur !== null &&
                        next != null &&
                        next - cur >= 2 &&
                        next - cur <= MAX_INLINE_GAP
                          ? rangeBetween(cur, next)
                          : null

                      return (
                        <Fragment key={item.id}>
                          <SortableFileItem
                            item={item}
                            index={index}
                            onRemove={removeItem}
                            disabled={isBusy}
                          />
                          {gap && (
                            <li className="flex items-center justify-center gap-1.5 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                              <TriangleAlert className="size-3.5" />
                              Missing {(seq.label ?? "number").toLowerCase()}
                              {gap.length > 1 ? "s" : ""}{" "}
                              {formatNumberRanges(gap)}
                            </li>
                          )}
                        </Fragment>
                      )
                    })}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed">
              <p className="text-sm text-muted-foreground">No PDFs added yet.</p>
            </div>
          )}
        </div>
      </main>

      {/* Pinned action bar */}
      <footer className="shrink-0 border-t bg-background">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-3">
          {error && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={handleMerge}
              disabled={!hasFiles || isBusy}
            >
              {busy === "merging" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Merge className="size-4" />
              )}
              Merge &amp; download PDF
            </Button>
            <Button onClick={handleConvert} disabled={!hasFiles || isBusy}>
              {busy === "converting" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookOpen className="size-4" />
              )}
              Convert to EPUB
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}
