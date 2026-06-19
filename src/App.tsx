import { useCallback, useState } from "react"
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
  Loader2,
  Merge,
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

  const autoOrder = () => setItems((prev) => [...prev].sort(byNaturalName))

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
                    {items.map((item, index) => (
                      <SortableFileItem
                        key={item.id}
                        item={item}
                        index={index}
                        onRemove={removeItem}
                        disabled={isBusy}
                      />
                    ))}
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
