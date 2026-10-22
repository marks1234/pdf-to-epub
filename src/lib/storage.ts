/**
 * IndexedDB-backed history of generated output files (merged PDFs / EPUBs).
 *
 * Stores the output Blob plus a lightweight record of what produced it
 * (title, author, source file names, page count). It does NOT store the raw
 * input PDF bytes — only their names.
 *
 * Chapter text lives in its own object store keyed by output id, so listing the
 * history never has to deserialize every book's full text. Use `getChapters(id)`
 * to pull them in on demand; listed records carry a `hasChapters` flag instead.
 *
 * A separate `queue` store holds the *input* queue — the PDFs the user has lined
 * up but not converted yet — so a reload does not lose their work. That one does
 * hold raw PDF bytes, but only for a single snapshot the user can clear.
 *
 * The pure helpers at the top (byte accounting, prune selection, the chapter
 * split/migration transform, the queue snapshot transforms) are exported so they
 * can be unit-tested without an IndexedDB implementation.
 */

import type { Chapter } from "@/lib/pdf-to-epub"
import type { StyleConfig } from "@/lib/styles"

const DB_NAME = "pdf-to-epub"
const STORE = "outputs"
const PROFILE_STORE = "styleProfiles"
const CHAPTER_STORE = "chapters"
const QUEUE_STORE = "queue"
const VERSION = 4

/** The queue store holds exactly one snapshot, under this fixed key. */
const QUEUE_KEY = "current"

/** Maximum number of outputs to retain; oldest beyond this are pruned. */
export const HISTORY_CAP = 50

/** Never let the history grow past this, however generous the browser quota. */
export const HARD_BYTE_BUDGET = 512 * 1024 * 1024

/** Fraction of the reported quota we are willing to occupy. */
export const QUOTA_FRACTION = 0.8

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
  /**
   * Reconstructed chapters (EPUBs only), kept so the EPUB can be re-styled.
   *
   * Only present on records you pass *into* `addOutput`; records returned by
   * `getAllOutputs` never carry it — call `getChapters(id)` instead.
   */
  chapters?: Chapter[]
  /** Whether chapter text is stored for this output (set on write/migration). */
  hasChapters?: boolean
  /** Rough byte cost of the stored chapters, used for quota accounting. */
  chaptersSize?: number
  /** The style config last applied to this EPUB (defaults to the built-in look). */
  style?: StyleConfig
  /**
   * Book metadata the EPUB was built with, so a re-style can reproduce it.
   * Older records predate this field; a re-style then falls back to title/author.
   */
  meta?: StoredBookMeta
}

/**
 * The book-level metadata an EPUB build consumes beyond title and author.
 *
 * Kept as a snapshot on the output record because a re-style rebuilds the whole
 * EPUB from stored chapters: without it, language, series, description and the
 * cover would silently vanish the first time the user touched the Style editor.
 */
export interface StoredBookMeta {
  /** BCP-47 tag driving `dc:language`. */
  language?: string
  description?: string
  series?: string
  seriesIndex?: number
  cover?: Blob
  /**
   * The `dc:title` actually written, which may be the Kindle series-sort form
   * ("Quest Academy 03 — Rise of the Guild") rather than the plain title shown
   * in the history list.
   */
  epubTitle?: string
}

/** A saved, reusable style configuration. */
export interface StyleProfile {
  id: string
  name: string
  config: StyleConfig
  createdAt: number
  updatedAt: number
}

// ── Pure helpers (unit-testable without IndexedDB) ───────────────────────────

/** Rough in-store byte cost of a chapter list (UTF-16 text plus per-item overhead). */
export function estimateChaptersBytes(chapters: Chapter[] | undefined): number {
  if (!chapters || chapters.length === 0) return 0
  let chars = 0
  for (const ch of chapters) {
    chars += ch.title.length + 16
    for (const b of ch.blocks) chars += b.text.length + 8
  }
  return chars * 2
}

/** The fields prune accounting needs — a full `OutputRecord` also satisfies this. */
export interface PruneCandidate {
  id: string
  createdAt: number
  size?: number
  chaptersSize?: number
}

/** Total bytes attributable to one record (blob + its chapter text). */
export function recordBytes(rec: PruneCandidate): number {
  return (rec.size ?? 0) + (rec.chaptersSize ?? 0)
}

/**
 * The byte budget to hold the history under: 80% of the browser-reported quota,
 * capped at `HARD_BYTE_BUDGET`. Falls back to the hard cap when no quota is known.
 */
export function computeByteBudget(
  quota: number | null | undefined,
  hardCap: number = HARD_BYTE_BUDGET,
): number {
  if (!quota || quota <= 0 || !Number.isFinite(quota)) return hardCap
  return Math.min(Math.floor(quota * QUOTA_FRACTION), hardCap)
}

export interface PruneOptions {
  /** Maximum number of records to keep (default `HISTORY_CAP`). */
  countCap?: number
  /** Maximum total bytes to keep (default: unlimited). */
  byteBudget?: number
  /** Bytes of a record about to be written, counted against the budget. */
  incomingBytes?: number
  /** Records about to be added (0 when this is a post-write tidy-up). */
  incomingCount?: number
  /** Never prune below this many records. */
  keepAtLeast?: number
}

/**
 * Pick the ids to evict, oldest first, until the history fits both the count cap
 * and the byte budget (with any incoming record accounted for). Deterministic:
 * equal timestamps break ties on id.
 */
export function selectPruneVictims(
  records: PruneCandidate[],
  opts: PruneOptions = {},
): string[] {
  const countCap = opts.countCap ?? HISTORY_CAP
  const byteBudget = opts.byteBudget ?? Number.POSITIVE_INFINITY
  const incomingBytes = opts.incomingBytes ?? 0
  const incomingCount = opts.incomingCount ?? 0
  const keepAtLeast = opts.keepAtLeast ?? 0

  const oldestFirst = [...records].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  let total = oldestFirst.reduce((sum, r) => sum + recordBytes(r), 0)
  let count = oldestFirst.length
  const maxVictims = Math.max(0, oldestFirst.length - keepAtLeast)

  const victims: string[] = []
  for (const r of oldestFirst) {
    if (victims.length >= maxVictims) break
    const overCount = count + incomingCount > countCap
    const overBytes = total + incomingBytes > byteBudget
    if (!overCount && !overBytes) break
    victims.push(r.id)
    total -= recordBytes(r)
    count--
  }
  return victims
}

export interface SplitRecord {
  /** The record as it is stored in the `outputs` store — never carries chapters. */
  record: OutputRecord
  /** The chapter text, destined for the `chapters` store (undefined if none). */
  chapters: Chapter[] | undefined
}

/**
 * Split a record into its listing metadata and its chapter text. Used both when
 * writing a new record and when migrating v2 records that embedded chapters.
 */
export function splitChapters(rec: OutputRecord): SplitRecord {
  const { chapters, ...rest } = rec
  const has = Array.isArray(chapters) && chapters.length > 0
  return {
    record: {
      ...rest,
      hasChapters: has ? true : (rec.hasChapters ?? false),
      chaptersSize: has ? estimateChaptersBytes(chapters) : (rec.chaptersSize ?? 0),
    },
    chapters: has ? chapters : undefined,
  }
}

// ── Queue snapshot (pure shape + transforms) ─────────────────────────────────

/**
 * One queued PDF as it is stored. `File` is structured-cloneable, but its
 * identity fields are not worth trusting across a round trip in every browser,
 * so name and lastModified are recorded explicitly and the file is rebuilt from
 * them on the way out.
 */
export interface QueuedFile {
  id: string
  name: string
  lastModified: number
  blob: Blob
  /** User-set chapter title; absent means "derive it from the name". */
  customTitle?: string
}

/** The Book-details fields that ride along with a saved queue. */
export interface QueueDetails {
  title?: string
  author?: string
  language?: string
  description?: string
  series?: string
  seriesIndex?: number
  cover?: Blob
  /** Whether the Kindle series-sort title was switched on. */
  kindleSeriesTitle?: boolean
}

/** Everything one saved queue holds. */
export interface QueueSnapshot {
  files: QueuedFile[]
  details: QueueDetails
  savedAt: number
}

/** The shape `toQueuedFiles` accepts — a `PdfItem` satisfies it structurally. */
export interface QueueItemLike {
  id: string
  file: File
  customTitle?: string
}

/** Reduce live queue items to the record shape the queue store holds. */
export function toQueuedFiles(items: QueueItemLike[]): QueuedFile[] {
  return items.map((item) => ({
    id: item.id,
    name: item.file.name,
    lastModified: item.file.lastModified,
    blob: item.file,
    ...(item.customTitle?.trim() ? { customTitle: item.customTitle.trim() } : {}),
  }))
}

/**
 * Rebuild live queue items from a stored snapshot, reconstructing each `File`
 * so name, size and lastModified match the original — which is what the
 * duplicate check in the dropzone keys on.
 *
 * Entries missing a blob (a partially written snapshot) are dropped rather than
 * restored as empty files.
 */
export function fromQueuedFiles(files: QueuedFile[]): QueueItemLike[] {
  return files
    .filter((f) => f.blob instanceof Blob)
    .map((f) => ({
      id: f.id || crypto.randomUUID(),
      file: new File([f.blob], f.name, {
        type: "application/pdf",
        lastModified: f.lastModified,
      }),
      ...(f.customTitle ? { customTitle: f.customTitle } : {}),
    }))
}

function isQuotaExceeded(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
  )
}

const QUOTA_MESSAGE =
  "Not enough browser storage to save this file. Delete some saved outputs " +
  "(or free up disk space) and try again."

// ── IndexedDB plumbing ───────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      const upgradeTx = req.transaction
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" })
        store.createIndex("createdAt", "createdAt")
      }
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(CHAPTER_STORE)) {
        // Out-of-line keys: the output id maps to a bare Chapter[].
        db.createObjectStore(CHAPTER_STORE)
        // v2 → v3: lift chapters embedded in existing records into the new store.
        if (upgradeTx) migrateEmbeddedChapters(upgradeTx)
      }
      // v3 → v4: purely additive. A single out-of-line snapshot of the input
      // queue; existing records need no rewriting.
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () =>
      reject(
        new Error(
          "Storage is locked by another open copy of this app. " +
            "Close other tabs of this app and reload.",
        ),
      )
  })
}

/** Move `chapters` off each existing output record and into the chapters store. */
function migrateEmbeddedChapters(upgradeTx: IDBTransaction): void {
  const outputs = upgradeTx.objectStore(STORE)
  const chapters = upgradeTx.objectStore(CHAPTER_STORE)
  const cursorReq = outputs.openCursor()
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result
    if (!cursor) return
    const split = splitChapters(cursor.value as OutputRecord)
    if (split.chapters) chapters.put(split.chapters, split.record.id)
    cursor.update(split.record)
    cursor.continue()
  }
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  store: string = STORE,
): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store)
}

/** Resolve when the transaction commits, reject on error/abort. */
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ── Outputs ──────────────────────────────────────────────────────────────────

/**
 * Persist an output. Chapter text (when supplied) goes to the chapters store;
 * re-saving a record *without* chapters (e.g. after a restyle) keeps the
 * previously stored chapters intact.
 *
 * Prunes ahead of the write when the record would blow the byte budget, and
 * retries once after an aggressive prune if the browser still says no.
 */
export async function addOutput(record: OutputRecord): Promise<void> {
  const split = splitChapters(record)

  await pruneToFit({ incoming: split.record, keepAtLeast: 0 })

  try {
    await writeOutput(split)
  } catch (e) {
    if (!isQuotaExceeded(e)) throw e
    // Evict oldest records to make room for the incoming one, then try once more.
    await freeSpace(recordBytes(split.record), split.record.id)
    try {
      await writeOutput(split)
    } catch (retryError) {
      if (isQuotaExceeded(retryError)) throw new Error(QUOTA_MESSAGE)
      throw retryError
    }
  }

  await prune()
}

async function writeOutput(split: SplitRecord): Promise<void> {
  const db = await openDB()
  try {
    const transaction = db.transaction([STORE, CHAPTER_STORE], "readwrite")
    const outputs = transaction.objectStore(STORE)
    const meta = { ...split.record }

    if (split.chapters) {
      transaction.objectStore(CHAPTER_STORE).put(split.chapters, meta.id)
      outputs.put(meta)
    } else {
      // No new chapters: carry forward whatever the existing record knew.
      const existingReq = outputs.get(meta.id)
      existingReq.onsuccess = () => {
        const existing = existingReq.result as OutputRecord | undefined
        if (existing?.hasChapters) {
          meta.hasChapters = true
          meta.chaptersSize = existing.chaptersSize ?? 0
        }
        outputs.put(meta)
      }
    }

    await done(transaction)
  } finally {
    db.close()
  }
}

/** All outputs, newest first. Chapter text is NOT included — see `getChapters`. */
export async function getAllOutputs(): Promise<OutputRecord[]> {
  const db = await openDB()
  try {
    const result = await req(tx(db, "readonly").getAll())
    return (result as OutputRecord[]).sort((a, b) => b.createdAt - a.createdAt)
  } finally {
    db.close()
  }
}

/** Load the stored chapter text for one output, or undefined if it has none. */
export async function getChapters(id: string): Promise<Chapter[] | undefined> {
  const db = await openDB()
  try {
    const result = await req(tx(db, "readonly", CHAPTER_STORE).get(id))
    return result as Chapter[] | undefined
  } finally {
    db.close()
  }
}

export async function deleteOutput(id: string): Promise<void> {
  const db = await openDB()
  try {
    const transaction = db.transaction([STORE, CHAPTER_STORE], "readwrite")
    transaction.objectStore(STORE).delete(id)
    transaction.objectStore(CHAPTER_STORE).delete(id)
    await done(transaction)
  } finally {
    db.close()
  }
}

export async function clearAllOutputs(): Promise<void> {
  const db = await openDB()
  try {
    const transaction = db.transaction([STORE, CHAPTER_STORE], "readwrite")
    transaction.objectStore(STORE).clear()
    transaction.objectStore(CHAPTER_STORE).clear()
    await done(transaction)
  } finally {
    db.close()
  }
}

/** Keep the history under both the count cap and the byte budget. */
async function prune(): Promise<void> {
  await pruneToFit({ keepAtLeast: 1 })
}

async function pruneToFit(opts: {
  incoming?: PruneCandidate
  keepAtLeast?: number
}): Promise<void> {
  const byteBudget = computeByteBudget((await getStorageEstimate())?.quota)
  const incoming = opts.incoming
  const all = await listCandidates()
  const victims = selectPruneVictims(
    incoming ? all.filter((r) => r.id !== incoming.id) : all,
    {
      countCap: HISTORY_CAP,
      byteBudget,
      incomingBytes: incoming ? recordBytes(incoming) : 0,
      incomingCount: incoming ? 1 : 0,
      keepAtLeast: opts.keepAtLeast ?? 0,
    },
  )
  await evict(victims)
}

/** Evict oldest records until at least `bytes` have been freed. */
async function freeSpace(bytes: number, exceptId?: string): Promise<void> {
  const all = (await listCandidates())
    .filter((r) => r.id !== exceptId)
    .sort((a, b) => a.createdAt - b.createdAt)

  const victims: string[] = []
  let freed = 0
  for (const r of all) {
    if (freed >= bytes) break
    victims.push(r.id)
    freed += recordBytes(r)
  }
  await evict(victims)
}

async function listCandidates(): Promise<OutputRecord[]> {
  const db = await openDB()
  try {
    return (await req(tx(db, "readonly").getAll())) as OutputRecord[]
  } finally {
    db.close()
  }
}

async function evict(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await openDB()
  try {
    const transaction = db.transaction([STORE, CHAPTER_STORE], "readwrite")
    const outputs = transaction.objectStore(STORE)
    const chapters = transaction.objectStore(CHAPTER_STORE)
    for (const id of ids) {
      outputs.delete(id)
      chapters.delete(id)
    }
    await done(transaction)
  } finally {
    db.close()
  }
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
  /** The ceiling the history prunes itself to; see `computeByteBudget`. */
  budget: number
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota, budget: computeByteBudget(quota) }
}

// ── Input queue ──────────────────────────────────────────────────────────────

/**
 * Save the current input queue, replacing any previous snapshot.
 *
 * Called from a debounced effect, so it is deliberately cheap and total: one
 * `put` of one record. Saving an empty queue is meaningful — it is how clearing
 * the queue is persisted.
 */
export async function saveQueue(
  files: QueuedFile[],
  details: QueueDetails = {},
): Promise<void> {
  const snapshot: QueueSnapshot = { files, details, savedAt: Date.now() }
  const db = await openDB()
  try {
    const store = tx(db, "readwrite", QUEUE_STORE)
    store.put(snapshot, QUEUE_KEY)
    await done(store.transaction)
  } catch (e) {
    if (isQuotaExceeded(e)) throw new Error(QUOTA_MESSAGE)
    throw e
  } finally {
    db.close()
  }
}

/** The saved queue, or null when nothing has been saved. */
export async function loadQueue(): Promise<QueueSnapshot | null> {
  const db = await openDB()
  try {
    const result = (await req(tx(db, "readonly", QUEUE_STORE).get(QUEUE_KEY))) as
      | QueueSnapshot
      | undefined
    if (!result || !Array.isArray(result.files)) return null
    return { ...result, details: result.details ?? {} }
  } finally {
    db.close()
  }
}

export async function clearQueue(): Promise<void> {
  const db = await openDB()
  try {
    const store = tx(db, "readwrite", QUEUE_STORE)
    store.delete(QUEUE_KEY)
    await done(store.transaction)
  } finally {
    db.close()
  }
}

// ── Style profiles ───────────────────────────────────────────────────────────

export async function saveStyleProfile(profile: StyleProfile): Promise<void> {
  const db = await openDB()
  try {
    const store = tx(db, "readwrite", PROFILE_STORE)
    store.put(profile)
    await done(store.transaction)
  } finally {
    db.close()
  }
}

export async function getStyleProfiles(): Promise<StyleProfile[]> {
  const db = await openDB()
  try {
    const result = await req(tx(db, "readonly", PROFILE_STORE).getAll())
    return (result as StyleProfile[]).sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function deleteStyleProfile(id: string): Promise<void> {
  const db = await openDB()
  try {
    const store = tx(db, "readwrite", PROFILE_STORE)
    store.delete(id)
    await done(store.transaction)
  } finally {
    db.close()
  }
}
