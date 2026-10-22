/**
 * Fetched chapters persisted in `chrome.storage.local`, so a reload, Back, or
 * a crash doesn't cost the fetching already done. Best effort throughout: any
 * storage problem (quota, "Extension context invalidated", no `chrome` at all)
 * is a cache miss, never a failure.
 */
import type { Block } from "@/lib/reconstruct"

import type { PostResult } from "./posts"

const PREFIX = "pc:v1:"
const keyOf = (id: string) => `${PREFIX}${id}`

interface Stored {
  v: 1
  title: string
  html: string
  blocks?: Block[]
  publishedAt?: string
  editedAt?: string
  savedAt: number
}

interface StorageArea {
  get(keys: string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

function area(): StorageArea | null {
  try {
    const c = (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome
    return c?.storage?.local ?? null
  } catch {
    return null
  }
}

const isStored = (v: unknown): v is Stored =>
  typeof v === "object" && v !== null && (v as Stored).v === 1 && typeof (v as Stored).title === "string" && typeof (v as Stored).html === "string"

/** Cached successes for these ids, in one storage read. */
export async function getMany(ids: string[]): Promise<Map<string, PostResult>> {
  const out = new Map<string, PostResult>()
  const a = area()
  if (!a || ids.length === 0) return out
  try {
    const got = await a.get(ids.map(keyOf))
    for (const id of ids) {
      const v = got[keyOf(id)]
      if (!isStored(v)) continue
      out.set(id, { ok: true, id, title: v.title, html: v.html, ...(v.blocks ? { blocks: v.blocks } : {}), publishedAt: v.publishedAt })
    }
  } catch {
    // a miss
  }
  return out
}

/** Persist one success; fire-and-forget. */
export async function put(r: PostResult, editedAt?: string): Promise<void> {
  const a = area()
  if (!a || !r.ok) return
  const value: Stored = { v: 1, title: r.title, html: r.html, blocks: r.blocks, publishedAt: r.publishedAt, editedAt, savedAt: Date.now() }
  try {
    await a.set({ [keyOf(r.id)]: value })
  } catch {
    // quota or a dead extension context: just don't cache
  }
}

async function keysWhere(pred: (key: string, v: unknown) => boolean): Promise<string[]> {
  const a = area()
  if (!a) return []
  try {
    const all = await a.get(null)
    return Object.keys(all).filter((k) => k.startsWith("pc:") && pred(k, all[k]))
  } catch {
    return []
  }
}

/** Remove every saved chapter. */
export async function clear(): Promise<void> {
  const keys = await keysWhere(() => true)
  try {
    if (keys.length) await area()?.remove(keys)
  } catch {
    // ignore
  }
}

/** Drop entries older than `maxAgeMs` (and anything unreadable). */
export async function prune(maxAgeMs = 30 * 86_400_000, now = Date.now()): Promise<void> {
  const keys = await keysWhere((_, v) => !isStored(v) || now - v.savedAt > maxAgeMs)
  try {
    if (keys.length) await area()?.remove(keys)
  } catch {
    // ignore
  }
}
