import { useCallback, useEffect, useState } from "react"

import type { Chapter } from "@/lib/pdf-to-epub"
import {
  addOutput,
  clearAllOutputs,
  deleteOutput,
  getAllOutputs,
  getChapters,
  getStorageEstimate,
  requestPersistence,
  type OutputRecord,
  type StorageEstimate,
} from "@/lib/storage"

/**
 * Loads and manages the IndexedDB output history. Requests persistent storage
 * once on mount and keeps a live storage estimate.
 */
export function useOutputs() {
  const [outputs, setOutputs] = useState<OutputRecord[]>([])
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [persisted, setPersisted] = useState<boolean>(false)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    const [list, est] = await Promise.all([getAllOutputs(), getStorageEstimate()])
    setOutputs(list)
    setEstimate(est)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const granted = await requestPersistence()
      if (!active) return
      setPersisted(granted)
      await refresh()
      if (active) setReady(true)
    })()
    return () => {
      active = false
    }
  }, [refresh])

  const add = useCallback(
    async (record: OutputRecord) => {
      await addOutput(record)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteOutput(id)
      await refresh()
    },
    [refresh],
  )

  const clear = useCallback(async () => {
    await clearAllOutputs()
    await refresh()
  }, [refresh])

  /**
   * Pull one output's chapter text in on demand. Listed records omit it (the
   * `hasChapters` flag says whether there is any) so that listing the history
   * never deserializes every stored book.
   */
  const loadChapters = useCallback(
    async (id: string): Promise<Chapter[] | undefined> => getChapters(id),
    [],
  )

  return {
    outputs,
    estimate,
    persisted,
    ready,
    add,
    remove,
    clear,
    loadChapters,
  }
}
