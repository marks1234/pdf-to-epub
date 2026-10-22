/**
 * The post-fetch controller: drives `fetchPostContent` over the selected posts
 * with a circuit breaker (pause, then halt, on a run of transient failures), an
 * auth probe (halt when the session looks logged out / challenged), and a
 * shared cache so every success survives a cancel, halt or retry.
 *
 * Pure of DOM and timers (sleep, online-wait and probe are injected), so the
 * whole policy is unit-tested with a fake Http.
 */
import { abortError, HttpError, isAbort, NotJsonError, sleep as realSleep, type Http } from "./http"
import { orderOldestFirst, parsePost, postUrl, ORIGIN, type ListingOrder, type PostRef } from "./patreon-api"
import { fetchPostContent, type PostResult } from "./posts"

export type HaltKind = "transient" | "auth"

export interface RunResult {
  /** In selection order; posts never reached are absent. */
  results: PostResult[]
  halted?: { kind: HaltKind; index: number; message: string }
}

/** Adaptive in-flight limit, shared with the HTTP layer's rate-limit signal. */
export interface Pool {
  limit: number
  readonly max: number
  /** Patreon pushed back (429 / 503): drop to one request in flight. */
  rateLimited(): void
  /** A success; after `growAfter` in a row the limit creeps back up by one. */
  succeeded(): void
}

export function createPool(max = 3, start = max, growAfter = 20): Pool {
  let streak = 0
  return {
    limit: Math.max(1, Math.min(start, max)),
    max,
    rateLimited() {
      this.limit = 1
      streak = 0
    },
    succeeded() {
      if (++streak >= growAfter) {
        streak = 0
        this.limit = Math.min(this.max, this.limit + 1)
      }
    },
  }
}

export interface RunDeps {
  http: Http
  cache: Map<string, PostResult>
  signal: AbortSignal
  /** Is the session still good? Defaults to {@link probeSession}. */
  probe?(lastOkId: string | undefined): Promise<boolean>
  onProgress?(done: number, total: number, label: string): void
  /** A pause message, or null when the pause ends. */
  onPause?(message: string | null): void
  /** Each fresh success, e.g. to persist it. */
  onResult?(r: PostResult): void
  /** Diagnostics. */
  log?(line: string): void
  pool?: Pool
  pauses?: number[]
  sleep?(ms: number, signal: AbortSignal): Promise<void>
  /** Resolves when the browser comes back online (ends a pause early). */
  waitOnline?(signal: AbortSignal): Promise<void>
  fetchPost?(ref: PostRef, http: Http): Promise<PostResult>
}

const TRANSIENT_PAUSE_AFTER = 3
const AUTH_PROBE_AFTER = 2
const LOCKED_PROBE_AFTER = 3
const REPROBE_AFTER = 10

/** Refetch a post that worked (or the current user) to tell "logged out" from "really locked". */
export async function probeSession(http: Http, lastOkId: string | undefined): Promise<boolean> {
  try {
    const json = await http.getJson(
      lastOkId ? postUrl(lastOkId) : `${ORIGIN}/api/current_user?fields[user]=full_name&json-api-version=1.0`,
    )
    if (lastOkId) {
      const post = parsePost(json)
      return post.canView !== false && (!!post.html || !!post.blocks)
    }
    return true
  } catch (e) {
    if (isAbort(e)) throw e
    if (e instanceof NotJsonError) return false
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) return false
    // Anything else (5xx, network) says nothing about the session.
    return true
  }
}

function defaultWaitOnline(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return
    const done = () => {
      window.removeEventListener("online", done)
      signal.removeEventListener("abort", done)
      resolve()
    }
    window.addEventListener("online", done, { once: true })
    signal.addEventListener("abort", done, { once: true })
  })
}

const label = (r: PostRef) => r.title || `Post ${r.id}`

export async function fetchAll(selected: PostRef[], deps: RunDeps): Promise<RunResult> {
  const {
    http,
    cache,
    signal,
    pool = createPool(1, 1),
    pauses = [30_000, 60_000, 120_000],
    sleep = realSleep,
    waitOnline = defaultWaitOnline,
    fetchPost = fetchPostContent,
    log,
  } = deps
  const probe = deps.probe ?? ((id: string | undefined) => probeSession(http, id))
  const total = selected.length
  const results: (PostResult | undefined)[] = new Array(total)
  let done = 0
  /** Indices to (re)fetch, lowest first. */
  const retry: number[] = []
  let cursor = 0
  const inflight = new Set<Promise<void>>()
  let fatal: unknown = null

  // Breaker state; all streaks are consecutive in completion order.
  let transientIdx: number[] = []
  let authStreak = 0
  let lockedStreak = 0
  let authThreshold = AUTH_PROBE_AFTER
  let lockedThreshold = LOCKED_PROBE_AFTER
  let anyOk = false
  let lastOkId: string | undefined
  let pauseNo = 0
  let wantPause = false
  let wantProbe = false
  let halted: RunResult["halted"]

  const takeNext = (): number | undefined => {
    if (retry.length) return retry.shift()
    return cursor < total ? cursor++ : undefined
  }

  const settle = (i: number, r: PostResult, fresh: boolean) => {
    results[i] = r
    done++
    deps.onProgress?.(done, total, label(selected[i]))
    if (r.ok) {
      if (fresh) {
        cache.set(r.id, r)
        deps.onResult?.(r)
        pool.succeeded()
      }
      anyOk = true
      lastOkId = r.id
      transientIdx = []
      authStreak = 0
      lockedStreak = 0
      pauseNo = 0
      return
    }
    log?.(`post ${r.id}: ${r.kind} — ${r.reason}`)
    if (r.kind === "missing" && fresh) cache.set(r.id, r)
    if (r.kind === "transient") {
      pool.rateLimited()
      transientIdx.push(i)
      if (transientIdx.length >= TRANSIENT_PAUSE_AFTER) wantPause = true
    } else if (r.kind === "auth") {
      if (++authStreak >= authThreshold) wantProbe = true
    } else if (r.kind === "locked" || r.kind === "missing") {
      if (anyOk && ++lockedStreak >= lockedThreshold) wantProbe = true
    }
  }

  const start = (i: number) => {
    const ref = selected[i]
    const cached = cache.get(ref.id)
    if (cached) return settle(i, cached, false)
    const job = fetchPost(ref, http).then(
      (r) => {
        if (!signal.aborted) settle(i, r, true)
      },
      (e) => {
        fatal ??= e
      },
    )
    const tracked = job.finally(() => inflight.delete(tracked))
    inflight.add(tracked)
  }

  const drain = () => Promise.all(inflight)
  const firstOpen = () => {
    const i = results.findIndex((r) => r === undefined)
    return i < 0 ? total : i
  }

  while (true) {
    if (signal.aborted) {
      await drain()
      throw abortError()
    }
    if (fatal) {
      await drain()
      throw fatal
    }
    if (wantPause || wantProbe) {
      await drain()
      if (signal.aborted || fatal) continue
      if (wantProbe) {
        wantProbe = false
        log?.(`probe (auth streak ${authStreak}, locked streak ${lockedStreak})`)
        const ok = await probe(lastOkId)
        log?.(`probe ${ok ? "passed" : "failed"}`)
        if (!ok) {
          halted = {
            kind: "auth",
            index: firstOpen(),
            message: "Patreon stopped returning post data — you may have been logged out, or a Cloudflare check is waiting. Reload the page and log in",
          }
          break
        }
        authStreak = 0
        lockedStreak = 0
        authThreshold = lockedThreshold = REPROBE_AFTER
      }
      if (wantPause) {
        wantPause = false
        if (pauseNo >= pauses.length) {
          halted = {
            kind: "transient",
            index: Math.min(...transientIdx, firstOpen()),
            message: "Patreon kept refusing requests or the connection kept failing",
          }
          break
        }
        const ms = pauses[pauseNo++]
        log?.(`pause ${pauseNo}: ${ms} ms after ${transientIdx.length} transient failures`)
        deps.onPause?.(`Patreon is limiting requests / connection lost — retrying in ${Math.round(ms / 1000)}s`)
        const ac = new AbortController()
        const onAbort = () => ac.abort()
        signal.addEventListener("abort", onAbort, { once: true })
        try {
          await Promise.race([sleep(ms, signal), waitOnline(ac.signal)])
        } finally {
          ac.abort()
          signal.removeEventListener("abort", onAbort)
        }
        deps.onPause?.(null)
        // Retry the failed posts of this streak rather than skipping them.
        for (const i of transientIdx) {
          results[i] = undefined
          done--
        }
        retry.push(...transientIdx)
        retry.sort((a, b) => a - b)
        transientIdx = []
      }
      continue
    }
    if (inflight.size >= pool.limit) {
      await Promise.race(inflight)
      continue
    }
    const i = takeNext()
    if (i === undefined) {
      if (inflight.size === 0) break
      await Promise.race(inflight)
      continue
    }
    start(i)
  }

  return { results: results.filter((r): r is PostResult => r !== undefined), ...(halted ? { halted } : {}) }
}

/**
 * A page-harvested listing had no dates up front: order the fetched posts by
 * what we learned, oldest first. Only successes are ordered (failures have no
 * date and would scramble it); failures follow in their original order.
 */
export function orderResults(results: PostResult[], order: ListingOrder): PostResult[] {
  if (order !== "newest-first") return results
  const ok = results.filter((r) => r.ok)
  const byId = new Map(ok.map((r) => [r.id, r]))
  const refs = orderOldestFirst(
    ok.map((r) => ({ id: r.id, title: r.title, publishedAt: r.ok ? r.publishedAt : undefined })),
    "newest-first",
  )
  return [...refs.map((r) => byId.get(r.id) as PostResult), ...results.filter((r) => !r.ok)]
}
