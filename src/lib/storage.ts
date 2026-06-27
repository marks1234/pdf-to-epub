/**
 * IndexedDB-backed history of generated output files (merged PDFs / EPUBs).
 *
 * Stores the output Blob plus a lightweight record of what produced it
 * (title, author, source file names, page count). It does NOT store the raw
 * input PDF bytes — only their names.
 */

import type { Chapter } from "@/lib/pdf-to-epub"
import type { StyleConfig } from "@/lib/styles"

const DB_NAME = "pdf-to-epub"
const STORE = "outputs"
const PROFILE_STORE = "styleProfiles"
const VERSION = 2

/** Maximum number of outputs to retain; oldest beyond this are pruned. */
export const HISTORY_CAP = 50

export type OutputKind = "pdf" | "epub"

export interface OutputRecord {
  id: string
  kind: OutputKind
  filename: string
  blob: Blob
  title: string
  author: string
  /** Names (only) of the input files that were merged/converted. */
  sources: string[]
  pageCount: number | null
  size: number
  createdAt: number
  /** Reconstructed chapters (EPUBs only), kept so the EPUB can be re-styled. */
  chapters?: Chapter[]
  /** The style config last applied to this EPUB (defaults to the built-in look). */
  style?: StyleConfig
}

/** A saved, reusable style configuration. */
export interface StyleProfile {
  id: string
  name: string
  config: StyleConfig
  createdAt: number
  updatedAt: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" })
        store.createIndex("createdAt", "createdAt")
      }
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE, { keyPath: "id" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  store: string = STORE,
): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store)
}

export async function addOutput(record: OutputRecord): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite")
    store.put(record)
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
  await prune()
  db.close()
}

export async function getAllOutputs(): Promise<OutputRecord[]> {
  const db = await openDB()
  const result = await new Promise<OutputRecord[]>((resolve, reject) => {
    const req = tx(db, "readonly").getAll()
    req.onsuccess = () => resolve(req.result as OutputRecord[])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return result.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteOutput(id: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite")
    store.delete(id)
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
  db.close()
}

export async function clearAllOutputs(): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite")
    store.clear()
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
  db.close()
}

/** Keep only the newest HISTORY_CAP records. */
async function prune(): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite")
    const countReq = store.count()
    countReq.onsuccess = () => {
      const excess = countReq.result - HISTORY_CAP
      if (excess <= 0) {
        resolve()
        return
      }
      let removed = 0
      // Oldest first along the createdAt index.
      const cursorReq = store.index("createdAt").openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor || removed >= excess) {
          resolve()
          return
        }
        cursor.delete()
        removed++
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    }
    countReq.onerror = () => reject(countReq.error)
  })
  db.close()
}

/** Ask the browser for durable (eviction-resistant) storage. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export interface StorageEstimate {
  usage: number
  quota: number
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}

// ── Style profiles ───────────────────────────────────────────────────────────

export async function saveStyleProfile(profile: StyleProfile): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite", PROFILE_STORE)
    store.put(profile)
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
  db.close()
}

export async function getStyleProfiles(): Promise<StyleProfile[]> {
  const db = await openDB()
  const result = await new Promise<StyleProfile[]>((resolve, reject) => {
    const req = tx(db, "readonly", PROFILE_STORE).getAll()
    req.onsuccess = () => resolve(req.result as StyleProfile[])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteStyleProfile(id: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const store = tx(db, "readwrite", PROFILE_STORE)
    store.delete(id)
    store.transaction.oncomplete = () => resolve()
    store.transaction.onerror = () => reject(store.transaction.error)
  })
  db.close()
}
