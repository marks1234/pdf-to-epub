import { useCallback, useEffect, useState } from "react"

import {
  deleteStyleProfile,
  getStyleProfiles,
  saveStyleProfile,
  type StyleProfile,
} from "@/lib/storage"
import type { StyleConfig } from "@/lib/styles"

/** Loads and manages saved style profiles from IndexedDB. */
export function useStyleProfiles() {
  const [profiles, setProfiles] = useState<StyleProfile[]>([])

  const refresh = useCallback(async () => {
    setProfiles(await getStyleProfiles())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(
    async (name: string, config: StyleConfig) => {
      const now = Date.now()
      await saveStyleProfile({
        id: crypto.randomUUID(),
        name,
        config,
        createdAt: now,
        updatedAt: now,
      })
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteStyleProfile(id)
      await refresh()
    },
    [refresh],
  )

  return { profiles, save, remove }
}
