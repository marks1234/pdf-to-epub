/**
 * The conversion worker.
 *
 * pdf.js already parses in a worker of its own, but everything after that —
 * layout reconstruction, de-hyphenation, jepub's EJS templating and JSZip's
 * recompression — used to run on the main thread and froze the UI for the whole
 * length of a long batch. This module worker owns the entire pipeline instead,
 * so the page stays interactive and a run can be cancelled part-way.
 *
 * Files arrive as `File` objects: they are structured-cloneable and cheap to
 * post (the browser hands over a reference to the on-disk blob), so the main
 * thread never reads them into memory.
 */
import * as pdfjsLib from "pdfjs-dist"
// Vite resolves this to a hashed URL for the pdf.js worker bundle.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

import {
  pdfToEpub,
  restyleEpub,
  type Chapter,
  type EpubMetadata,
  type FileFailure,
} from "@/lib/pdf-to-epub"
import type { StyleConfig } from "@/lib/styles"

// ── Message protocol ─────────────────────────────────────────────────────────

/** Which half of the run a progress report describes. */
export type ProgressPhase = "extract" | "build"

export interface ConvertRequest {
  type: "convert"
  files: File[]
  meta: EpubMetadata
  config?: StyleConfig
}

/** Re-render stored chapters with a new style — jepub and JSZip block too. */
export interface RestyleRequest {
  type: "restyle"
  chapters: Chapter[]
  meta: EpubMetadata
  config: StyleConfig
  /** Keeps every re-style of one book the same book to a reader device. */
  identifier?: string
}

export interface CancelRequest {
  type: "cancel"
}

export type WorkerRequest = ConvertRequest | RestyleRequest | CancelRequest

export type WorkerResponse =
  | {
      type: "progress"
      done: number
      total: number
      currentName: string
      phase: ProgressPhase
    }
  | {
      type: "done"
      blob: Blob
      chapters: Chapter[]
      pageCount: number
      failures: FileFailure[]
      emptyChapters: string[]
    }
  | { type: "cancelled" }
  | { type: "error"; message: string }

// ── Worker globals ───────────────────────────────────────────────────────────

// `lib` is DOM (the app is a browser app), so `self` is typed as a Window here.
// Narrow it to the two worker entry points we actually use.
const ctx = globalThis as unknown as {
  postMessage(message: WorkerResponse): void
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void
}

function post(message: WorkerResponse): void {
  ctx.postMessage(message)
}

// ── pdf.js inside a worker ───────────────────────────────────────────────────

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/**
 * Run pdf.js in "fake worker" mode — parsing on *this* thread rather than in a
 * nested worker of its own.
 *
 * pdf.js decides how to start its worker in `PDFWorker._initialize()`, which
 * reads `window.location.href` to compare origins. There is no `window` in a
 * worker, so that path throws and pdf.js silently falls back to a fake worker
 * anyway. Rather than depend on an error being caught somewhere inside a
 * dependency, take the branch deliberately: pdf.js checks
 * `globalThis.pdfjsWorker?.WorkerMessageHandler` *first* and uses it directly
 * when present. Loading the module here also means it is fetched once, up
 * front, instead of lazily mid-conversion.
 *
 * Parsing on this thread is fine — the point is to be off the *UI* thread — and
 * it avoids nested workers entirely (Safari only gained those in 16.4). The
 * dynamic import is of an already-emitted asset URL, so Vite cannot (and need
 * not) analyze it.
 */
let pdfWorkerReady: Promise<void> | null = null

function ensurePdfWorker(): Promise<void> {
  pdfWorkerReady ??= (async () => {
    try {
      const mod = await import(/* @vite-ignore */ pdfWorkerUrl)
      ;(globalThis as unknown as Record<string, unknown>).pdfjsWorker = mod
    } catch {
      // Leave it to pdf.js's own fallback, which does the same import lazily.
    }
  })()
  return pdfWorkerReady
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

/** The run in flight, so a `cancel` message can abort it. */
let controller: AbortController | null = null

function isAbortError(e: unknown): boolean {
  return (
    !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError"
  )
}

async function runConvert(
  req: ConvertRequest,
  signal: AbortSignal,
): Promise<void> {
  await ensurePdfWorker()
  const result = await pdfToEpub(req.files, req.meta, req.config, {
    signal,
    // The last file's report is also the handover to the (unmeasurable) build
    // phase: templating and zipping the whole book happen after it.
    onProgress: (done, total, currentName) =>
      post({
        type: "progress",
        done,
        total,
        currentName,
        phase: done === total ? "build" : "extract",
      }),
  })
  if (signal.aborted) {
    post({ type: "cancelled" })
    return
  }
  post({
    type: "done",
    blob: result.blob,
    chapters: result.chapters,
    pageCount: result.pageCount,
    failures: result.failures,
    emptyChapters: result.emptyChapters,
  })
}

async function runRestyle(
  req: RestyleRequest,
  signal: AbortSignal,
): Promise<void> {
  const blob = await restyleEpub(
    req.chapters,
    req.meta,
    req.config,
    req.identifier,
  )
  if (signal.aborted) {
    post({ type: "cancelled" })
    return
  }
  // A re-style re-uses the chapters it was handed and learns nothing new.
  post({
    type: "done",
    blob,
    chapters: req.chapters,
    pageCount: 0,
    failures: [],
    emptyChapters: [],
  })
}

ctx.addEventListener("message", (event) => {
  const req = event.data

  if (req.type === "cancel") {
    controller?.abort()
    return
  }

  controller = new AbortController()
  const { signal } = controller
  const job = req.type === "convert" ? runConvert(req, signal) : runRestyle(req, signal)

  void job.catch((e: unknown) => {
    if (signal.aborted || isAbortError(e)) {
      post({ type: "cancelled" })
      return
    }
    post({
      type: "error",
      message: e instanceof Error ? e.message : "Conversion failed.",
    })
  })
})
