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
  Download,
  FileText,
  HardDriveDownload,
  Inbox,
  Loader2,
  Merge,
  TriangleAlert,
  Trash2,
  UploadCloud,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  SortableFileItem,
  type PdfItem,
} from "@/components/sortable-file-item"
import { MemoField } from "@/components/memo-field"
import { cn } from "@/lib/utils"
import { mergePdfs, countPages } from "@/lib/merge-pdf"
import { pdfToEpub } from "@/lib/pdf-to-epub"
import { downloadBlob } from "@/lib/download"
import { formatBytes, formatDate } from "@/lib/format"
import { HISTORY_CAP } from "@/lib/storage"
import {
  analyzeSequence,
  extractNumber,
  formatNumberRanges,
  rangeBetween,
} from "@/lib/sequence"
import { useNameMemory } from "@/hooks/use-name-memory"
import { useOutputs } from "@/hooks/use-outputs"

type Busy = "idle" | "merging" | "converting"

/** Largest gap span we annotate inline; bigger gaps are only shown in the banner. */
const MAX_INLINE_GAP = 26

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

  const titleMemory = useNameMemory("pdf2epub.titles")
  const authorMemory = useNameMemory("pdf2epub.authors")
  const history = useOutputs()

  const seq = useMemo(
    () => analyzeSequence(items.map((i) => i.file.name)),
    [items],
  )

  const sensors = useSensors(
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

  const rememberNames = () => {
    titleMemory.remember(title)
    if (author.trim()) authorMemory.remember(author)
  }

  const handleMerge = async () => {
    setError(null)
    setBusy("merging")
    try {
      const files = items.map((i) => i.file)
      const [bytes, pages] = await Promise.all([
        mergePdfs(files),
        countPages(files),
      ])
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" })
      await history.add({
        id: crypto.randomUUID(),
        kind: "pdf",
        filename: `${title || "merged"}.pdf`,
        blob,
        title: title || "Merged Document",
        author,
        sources: files.map((f) => f.name),
        pageCount: pages,
        size: blob.size,
        createdAt: Date.now(),
      })
      rememberNames()
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
      const files = items.map((i) => i.file)
      const bytes = await mergePdfs(files)
      const pages = await countPages(files)
      const blob = await pdfToEpub(bytes, {
        title: title || "Merged Document",
        author: author || "Unknown",
      })
      await history.add({
        id: crypto.randomUUID(),
        kind: "epub",
        filename: `${title || "merged"}.epub`,
        blob,
        title: title || "Merged Document",
        author,
        sources: files.map((f) => f.name),
        pageCount: pages,
        size: blob.size,
        createdAt: Date.now(),
      })
      rememberNames()
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
        <div className="px-4 py-3">
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

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* LEFT — input & queue */}
        <section className="flex min-h-0 flex-col overflow-hidden lg:border-r">
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={cn(
                "flex shrink-0 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition-colors",
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

            {/* Metadata with remembered names */}
            <div className="grid shrink-0 gap-3 sm:grid-cols-2">
              <MemoField
                id="title"
                label="Title"
                value={title}
                placeholder="Merged Document"
                onChange={setTitle}
                saved={titleMemory.values}
                onForget={titleMemory.forget}
              />
              <MemoField
                id="author"
                label="Author"
                value={author}
                placeholder="Unknown"
                onChange={setAuthor}
                saved={authorMemory.values}
                onForget={authorMemory.forget}
              />
            </div>

            {/* Toolbar */}
            {hasFiles && (
              <div className="flex shrink-0 items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {items.length} {items.length === 1 ? "file" : "files"} · drag
                  to reorder
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
                <p className="text-sm text-muted-foreground">
                  No PDFs added yet.
                </p>
              </div>
            )}
          </div>

          {/* Pinned action bar */}
          <div className="shrink-0 border-t bg-background p-3">
            {error && (
              <p className="mb-2 text-sm font-medium text-destructive" role="alert">
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
                Merge PDF
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
        </section>

        {/* RIGHT — output history */}
        <section className="flex min-h-0 flex-col overflow-hidden border-t lg:border-t-0">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <HardDriveDownload className="size-4" />
                Output
              </h2>
              <p className="text-xs text-muted-foreground">
                {history.outputs.length}/{HISTORY_CAP} saved
                {history.estimate &&
                  ` · ${formatBytes(history.estimate.usage)} used`}
                {history.persisted ? " · persistent" : " · best-effort"}
              </p>
            </div>
            {history.outputs.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void history.clear()}
              >
                <Trash2 className="size-4" />
                Clear all
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {history.outputs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Inbox className="size-8" />
                <p>
                  No outputs yet. Merge or convert and the file appears here —
                  saved on this device.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {history.outputs.map((out) => (
                  <li
                    key={out.id}
                    className="rounded-lg border p-3"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-md",
                          out.kind === "epub"
                            ? "bg-primary/10 text-primary"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {out.kind === "epub" ? (
                          <BookOpen className="size-4" />
                        ) : (
                          <FileText className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {out.filename}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {out.title}
                          {out.author ? ` · ${out.author}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {out.sources.length} source
                          {out.sources.length === 1 ? "" : "s"}
                          {out.pageCount != null && ` · ${out.pageCount} pages`}{" "}
                          · {formatBytes(out.size)} · {formatDate(out.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          downloadBlob(out.blob, out.filename, out.blob.type)
                        }
                      >
                        <Download className="size-4" />
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void history.remove(out.id)}
                        aria-label={`Delete ${out.filename}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
