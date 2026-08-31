import { useCallback, useEffect, useRef, useState } from "react"

import type { PdfItem } from "@/components/sortable-file-item"
import {
  clearQueue,
  fromQueuedFiles,
  loadQueue,
  saveQueue,
  toQueuedFiles,
  type QueueDetails,
} from "@/lib/storage"

/** How long the queue must sit still before it is written to IndexedDB. */
export const QUEUE_SAVE_DELAY = 500

interface UseQueuePersistenceArgs {
  items: PdfItem[]
  /** Book details typed alongside the queue; persisted with it. */
  details: QueueDetails
  /** True while a conversion is running — no restore, no writes. */
  busy: boolean
  /**
   * Handed the restored queue exactly once, on mount, when one was found. Only
   * the latest reference is used, so it need not be stable.
   */
  onRestore: (items: PdfItem[], details: QueueDetails) => void
}

/**
 * Keeps the input queue in IndexedDB so a reload (or a crashed tab) does not
 * lose a 90-file batch someone spent minutes ordering.
 *
 * Writes are debounced: dragging a row fires a state update per frame, and each
 * write re-serializes every queued PDF's bytes. Restoring happens once on mount
 * and only into an empty queue — if the user managed to drop files before the
 * read came back, what they just did wins.
 *
 * The snapshot is *not* cleared after a successful conversion: re-converting the
 * same queue with a different style is a normal thing to want. It is cleared
 * only when the user clears the queue.
 */
export function useQueuePersistence({
  items,
  details,
  busy,
  onRestore,
}: UseQueuePersistenceArgs) {
  /** How many files the mount-time restore brought back; 0 once dismissed. */
  const [restoredCount, setRestoredCount] = useState(0)
  /** Nothing is written until the restore has settled, or it would race it. */
  const [ready, setReady] = useState(false)

  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const snapshot = await loadQueue()
        if (!active) return
        if (
          snapshot &&
          snapshot.files.length > 0 &&
          itemsRef.current.length === 0
        ) {
          const restored = fromQueuedFiles(snapshot.files) as PdfItem[]
          if (restored.length > 0) {
            onRestoreRef.current(restored, snapshot.details)
            setRestoredCount(restored.length)
          }
        }
      } catch {
        // A missing, blocked or unreadable snapshot just means "start empty".
      }
      if (active) setReady(true)
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!ready || busy) return
    const timer = setTimeout(() => {
      void saveQueue(toQueuedFiles(items), details).catch(() => {
        // Best-effort: a full or blocked store must not break the session.
      })
    }, QUEUE_SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [ready, busy, items, details])

  /** Hide the "restored N files" banner without touching what was restored. */
  const dismissRestore = useCallback(() => setRestoredCount(0), [])

  /** Forget the saved queue entirely; the caller empties the live queue. */
  const clear = useCallback(async () => {
    setRestoredCount(0)
    try {
      await clearQueue()
    } catch {
      // The debounced write that follows an emptied queue covers this anyway.
    }
  }, [])

  return { restoredCount, dismissRestore, clear }
}
