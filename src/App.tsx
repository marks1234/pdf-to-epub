import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FileText,
  Loader2,
  Merge,
  Trash2,
  UploadCloud,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { mergePdfs } from "@/lib/merge-pdf"
import { pdfToEpub } from "@/lib/pdf-to-epub"
import { downloadBlob } from "@/lib/download"

type Busy = "idle" | "merging" | "converting"

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function App() {
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState("Merged Document")
  const [author, setAuthor] = useState("")
  const [busy, setBusy] = useState<Busy>("idle")
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback((accepted: File[]) => {
    setError(null)
    setFiles((prev) => [...prev, ...accepted])
  }, [])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    noClick: true,
    noKeyboard: true,
  })

  const move = (index: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const next = [...prev]
      const target = index + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const remove = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index))

  const handleMerge = async () => {
    setError(null)
    setBusy("merging")
    try {
      const bytes = await mergePdfs(files)
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
      const bytes = await mergePdfs(files)
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
  const hasFiles = files.length > 0

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BookOpen className="size-6" />
            PDF Merge &amp; EPUB
          </h1>
          <p className="text-sm text-muted-foreground">
            Combine PDFs and convert them to EPUB — everything runs locally in
            your browser. No uploads.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>1. Add PDFs</CardTitle>
            <CardDescription>
              Drag &amp; drop files, or browse. They merge in the order shown.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              {...getRootProps()}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                isDragActive ? "border-primary bg-accent" : "border-input",
              )}
            >
              <input {...getInputProps()} />
              <UploadCloud className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isDragActive
                  ? "Drop the PDFs here…"
                  : "Drag PDF files here"}
              </p>
              <Button variant="secondary" size="sm" onClick={open} type="button">
                Browse files
              </Button>
            </div>

            {hasFiles && (
              <ul className="divide-y rounded-lg border">
                {files.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-3 p-3"
                  >
                    <FileText className="size-5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSize(file.size)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => move(i, -1)}
                        disabled={i === 0 || isBusy}
                        aria-label="Move up"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => move(i, 1)}
                        disabled={i === files.length - 1 || isBusy}
                        aria-label="Move down"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(i)}
                        disabled={isBusy}
                        aria-label="Remove"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Details &amp; export</CardTitle>
            <CardDescription>
              Used as metadata in the EPUB and the output file name.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Merged Document"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="author">Author</Label>
              <Input
                id="author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Unknown"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="w-full sm:w-auto"
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
            <Button
              className="w-full sm:w-auto"
              onClick={handleConvert}
              disabled={!hasFiles || isBusy}
            >
              {busy === "converting" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BookOpen className="size-4" />
              )}
              Convert to EPUB
            </Button>
          </CardFooter>
        </Card>

        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}

        <footer className="text-center text-xs text-muted-foreground">
          Built with React, shadcn/ui &amp; pdf-lib · works offline (PWA)
        </footer>
      </div>
    </div>
  )
}
