import { useCallback, useEffect, useRef, useState } from "react"

import type {
  Chapter,
  ConvertResult,
  EpubMetadata,
} from "@/lib/pdf-to-epub"
import type { StyleConfig } from "@/lib/styles"
import type {
  ProgressPhase,
  WorkerRequest,
  WorkerResponse,
} from "@/workers/convert.worker"

/** How far along a run is; `null` between runs. */
export interface ConvertProgress {
  /** Files finished so far. */
  done: number
  /** Files in the batch. */
  total: number
  /** The file just finished — or, before the first one, the one starting. */
  currentName: string
  phase: ProgressPhase
}

/** True for the rejection a cancelled run produces, which callers absorb quietly. */
export function isAbortError(e: unknown): boolean {
  return (
    !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError"
  )
}

function abortError(): DOMException {
  return new DOMException("Conversion cancelled.", "AbortError")
}

type Job =
  | {
      kind: "convert"
      files: File[]
      meta: EpubMetadata
      config?: StyleConfig
      /** Chapter titles, index-aligned with `files`; blanks derive from the name. */
      titles?: (string | undefined)[]
    }
  | {
      kind: "restyle"
      chapters: Chapter[]
      meta: EpubMetadata
      config: StyleConfig
      identifier?: string
    }

/**
 * Runs EPUB conversion (and re-styling) in a dedicated module worker, exposing
 * live progress and a working cancel.
 *
 * A fresh worker is spawned per run and terminated when it settles: pdf.js
 * caches parsed documents and fonts per realm, so a throwaway worker is the
 * cheapest way to guarantee a 90-file batch does not inherit the last one's
 * memory. Terminating is also what makes Cancel instant — it does not wait for
 * a step (jepub templating, JSZip deflate) that cannot check an abort signal.
 *
 * If the worker cannot be created or dies before it says anything — no module
 * worker support, a `file://` page, a blocked script — the run is redone on the
 * main thread with the same progress reporting. Same UX, just janky.
 */
export function useConverter() {
  const [progress, setProgress] = useState<ConvertProgress | null>(null)
  /** Cancels the run in flight; `null` when idle. */
  const cancelRef = useRef<(() => void) | null>(null)

  // Never leave a worker (or a half-finished conversion) behind on unmount.
  useEffect(() => () => cancelRef.current?.(), [])

  const run = useCallback((job: Job): Promise<ConvertResult> => {
    return new Promise<ConvertResult>((resolve, reject) => {
      let worker: Worker | null = null
      let settled = false
      /** Set once the worker proves it loaded, so we know errors are real. */
      let heardFromWorker = false
      // Only the main-thread fallback can act on this; the worker path cancels
      // by terminating. Both share it so `run` has one cancellation story.
      const controller = new AbortController()

      const finish = (settle: () => void) => {
        if (settled) return
        settled = true
        cancelRef.current = null
        worker?.terminate()
        worker = null
        setProgress(null)
        settle()
      }

      cancelRef.current = () => {
        controller.abort()
        // Let the worker unwind cleanly if it can hear us, then drop it.
        worker?.postMessage({ type: "cancel" } satisfies WorkerRequest)
        finish(() => reject(abortError()))
      }

      const report = (done: number, total: number, currentName: string) =>
        setProgress({
          done,
          total,
          currentName,
          phase: done === total ? "build" : "extract",
        })

      /** No usable worker: do the work here, blocking the UI but finishing. */
      const runOnMainThread = () => {
        // Imported lazily so the heavy pipeline (pdf.js, jepub, JSZip) stays out
        // of the main bundle on the path where the worker does work.
        void import("@/lib/pdf-to-epub")
          .then(({ pdfToEpub, restyleEpub }) =>
            job.kind === "convert"
              ? pdfToEpub(job.files, job.meta, job.config, {
                  onProgress: report,
                  signal: controller.signal,
                  titles: job.titles,
                })
              : // Re-styling has no cancellable seam; a cancel just stops
                // waiting for it.
                restyleEpub(
                  job.chapters,
                  job.meta,
                  job.config,
                  job.identifier,
                ).then((blob) => ({
                  blob,
                  chapters: job.chapters,
                  pageCount: 0,
                  failures: [],
                  emptyChapters: [],
                })),
          )
          .then(
            (result) => finish(() => resolve(result)),
            (e: unknown) => finish(() => reject(e)),
          )
      }

      try {
        worker = new Worker(
          new URL("../workers/convert.worker.ts", import.meta.url),
          { type: "module" },
        )
      } catch {
        runOnMainThread()
        return
      }

      worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
        heardFromWorker = true
        const msg = event.data
        switch (msg.type) {
          case "progress":
            setProgress({
              done: msg.done,
              total: msg.total,
              currentName: msg.currentName,
              phase: msg.phase,
            })
            break
          case "done":
            finish(() =>
              resolve({
                blob: msg.blob,
                chapters: msg.chapters,
                pageCount: msg.pageCount,
                failures: msg.failures,
                emptyChapters: msg.emptyChapters,
              }),
            )
            break
          case "cancelled":
            finish(() => reject(abortError()))
            break
          case "error":
            finish(() => reject(new Error(msg.message)))
            break
        }
      })

      // A worker that dies before its first message never loaded at all.
      worker.addEventListener("error", (event: ErrorEvent) => {
        event.preventDefault()
        if (heardFromWorker) {
          finish(() =>
            reject(new Error(event.message || "The conversion worker failed.")),
          )
          return
        }
        worker?.terminate()
        worker = null
        runOnMainThread()
      })

      worker.addEventListener("messageerror", () => {
        finish(() =>
          reject(new Error("The conversion worker sent an unreadable message.")),
        )
      })

      const request: WorkerRequest =
        job.kind === "convert"
          ? {
              type: "convert",
              files: job.files,
              meta: job.meta,
              config: job.config,
              titles: job.titles,
            }
          : {
              type: "restyle",
              chapters: job.chapters,
              meta: job.meta,
              config: job.config,
              identifier: job.identifier,
            }
      worker.postMessage(request)
    })
  }, [])

  /**
   * Convert a batch of PDFs; rejects with an `AbortError` if cancelled.
   *
   * `titles` (index-aligned with `files`) overrides the name-derived chapter
   * titles; leave an entry undefined to keep the derived one.
   */
  const convert = useCallback(
    (
      files: File[],
      meta: EpubMetadata,
      config?: StyleConfig,
      titles?: (string | undefined)[],
    ) => run({ kind: "convert", files, meta, config, titles }),
    [run],
  )

  /** Re-render stored chapters into a new EPUB with a different style. */
  const restyle = useCallback(
    async (
      chapters: Chapter[],
      meta: EpubMetadata,
      config: StyleConfig,
      identifier?: string,
    ): Promise<Blob> =>
      (await run({ kind: "restyle", chapters, meta, config, identifier })).blob,
    [run],
  )

  const cancel = useCallback(() => cancelRef.current?.(), [])

  return { convert, restyle, cancel, progress }
}
