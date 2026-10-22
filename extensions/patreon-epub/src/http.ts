/**
 * A polite HTTP client: a jittered gap between request starts, a per-try
 * timeout, bounded retries with backoff on 408 / 429 / 5xx / network errors,
 * and a shared rate-limit cooldown so one 429 slows the whole run, not just one
 * request. Uses the page's own cookies (`credentials: "include"`) for Patreon,
 * so it reads exactly what the logged-in user can read — nothing more.
 */

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

const mediaType = (ct: string | null): string | null => (ct ? ct.split(";")[0].trim() || null : null)

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly contentType: string | null = null,
  ) {
    const ct = mediaType(contentType)
    super(`HTTP ${status}${ct ? ` (${ct})` : ""} for ${pathOf(url)}`)
    this.name = "HttpError"
  }
}

/** A 2xx that isn't JSON (a login page, a Cloudflare challenge) or that was redirected. */
export class NotJsonError extends Error {
  constructor(
    readonly status: number,
    readonly contentType: string | null,
    readonly url: string,
    readonly redirected: boolean,
  ) {
    super(
      `Expected JSON but got ${mediaType(contentType) ?? "no content type"}${redirected ? " after a redirect" : ""} for ${pathOf(url)} — logged out, or a Cloudflare check?`,
    )
    this.name = "NotJsonError"
  }
}

/** An image request that answered with something that isn't an image. */
export class NotImageError extends Error {
  constructor(
    readonly contentType: string | null,
    readonly url: string,
  ) {
    super(`Expected an image but got ${mediaType(contentType) ?? "no content type"} for ${pathOf(url)}`)
    this.name = "NotImageError"
  }
}

/** One fetch try, for diagnostics. Never carries bodies or cookies. */
export interface AttemptInfo {
  url: string
  tryNo: number
  ms: number
  status?: number
  contentType?: string | null
  redirected?: boolean
  cfMitigated?: string | null
  retryAfter?: string | null
  error?: string
}

export type WaitReason = "rate-limit" | "unavailable"

export interface HttpOptions {
  signal?: AbortSignal
  /** Gap between consecutive request starts, in ms (jittered between min and max). */
  minDelayMs?: number
  maxDelayMs?: number
  /** Retries after the first attempt (429s have their own budget). */
  retries?: number
  /** Base backoff in ms; doubles per retry. */
  backoffMs?: number
  /** Per-try timeout; defaults to 30 s for JSON/text and 60 s for images. */
  timeoutMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
  now?: () => number
  /** Patreon asked us to wait (429, or 503 + Retry-After). */
  onWait?(ms: number, reason: WaitReason): void
  /** Every finished try, for diagnostics. */
  onAttempt?(info: AttemptInfo): void
  /** Every parsed JSON body, for diagnostics (shape fingerprints). */
  onJson?(url: string, value: unknown): void
  /** Requests allowed in flight at once (default 1: strictly sequential). */
  concurrency?: number
}

export interface Http {
  getJson(url: string): Promise<unknown>
  getText(url: string): Promise<string>
  getBytes(url: string): Promise<ArrayBuffer>
}

export function abortError(): DOMException {
  return new DOMException("Cancelled.", "AbortError")
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError"
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

const RETRYABLE = (status: number) => status === 408 || status === 429 || status >= 500
const RETRY_AFTER_CAP = 300_000
const RATE_LIMIT_BUDGET_MS = 600_000
const RATE_LIMIT_MAX = 8

/** Retry-After as ms (seconds or an HTTP date), capped at five minutes. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return Math.min(RETRY_AFTER_CAP, Math.max(0, secs * 1000))
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.min(RETRY_AFTER_CAP, Math.max(0, at - now))
}

const isPatreon = (url: string) => url.startsWith("https://www.patreon.com/")
const errName = (e: unknown) => (e instanceof Error || e instanceof DOMException ? e.name : typeof e)

export function createHttp(options: HttpOptions = {}): Http & { readonly slow: number } {
  const {
    signal,
    minDelayMs = 600,
    maxDelayMs = 900,
    retries = 3,
    backoffMs = 2000,
    timeoutMs,
    fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
    sleep: wait = sleep,
    random = Math.random,
    now = Date.now,
    onWait,
    onAttempt,
    onJson,
    concurrency = 1,
  } = options
  let lastRequestAt = 0
  /** No Patreon request starts before this (set by 429 / 503 + Retry-After). */
  let cooldownUntil = 0
  /** Multiplier on the gap; doubles on a rate limit, decays on success. */
  let slow = 1
  // At most `concurrency` requests in flight (1 = strictly sequential).
  let active = 0
  const waiters: (() => void)[] = []
  // Request starts pass through one gate, so the gap and cooldown hold across
  // concurrent requests too.
  let gate: Promise<void> = Promise.resolve()

  function reserveStart(patreon: boolean): Promise<void> {
    const turn = gate.then(async () => {
      const gap = (minDelayMs + random() * (maxDelayMs - minDelayMs)) * (patreon ? slow : 1)
      const waitFor = Math.max(lastRequestAt ? lastRequestAt + gap : 0, patreon ? cooldownUntil : 0) - now()
      if (waitFor > 0) await wait(waitFor, signal)
      lastRequestAt = now()
    })
    gate = turn.catch(() => undefined)
    return turn
  }

  const backoff = (n: number) => backoffMs * 2 ** n * (1 + random() * 0.25)

  async function attempt<T>(
    url: string,
    accept: string,
    read: (r: Response) => Promise<T>,
    perTryMs: number,
    maxRetries: number,
    retryTypeError: boolean,
  ): Promise<T> {
    const patreon = isPatreon(url)
    let rateLimits = 0
    let rateWaited = 0
    for (let tryNo = 0; ; ) {
      if (signal?.aborted) throw abortError()
      await reserveStart(patreon)
      const startedAt = now()

      const ts = AbortSignal.timeout(perTryMs)
      const s = signal ? AbortSignal.any([signal, ts]) : ts
      let res: Response | null = null
      let failure: unknown = null
      const report = (extra: Partial<AttemptInfo>) =>
        onAttempt?.({
          url,
          tryNo,
          ms: now() - startedAt,
          status: res?.status,
          contentType: res?.headers.get("content-type") ?? null,
          redirected: res?.redirected,
          cfMitigated: res?.headers.get("cf-mitigated") ?? null,
          retryAfter: res?.headers.get("Retry-After") ?? null,
          ...extra,
        })
      try {
        res = await fetchImpl(url, {
          // Cookies only go to Patreon itself; a CDN image is fetched anonymously
          // (credentialed CORS requests to a wildcard-CORS CDN would fail).
          credentials: patreon ? "include" : "omit",
          headers: { Accept: accept },
          signal: s,
        })
        if (res.ok) {
          const value = await read(res)
          report({})
          if (patreon) slow = Math.max(1, slow * 0.9)
          return value
        }
      } catch (e) {
        // A user cancel always wins over whatever else went wrong.
        if (signal?.aborted) throw abortError()
        report({ error: errName(e) })
        // Deterministic: retrying returns the same thing.
        if (e instanceof NotJsonError || e instanceof NotImageError) throw e
        failure = e
      }

      if (failure !== null || !res) {
        // A timeout, a TypeError, or a body read that failed after a 200.
        rateLimits = 0
        if ((!retryTypeError && failure instanceof TypeError) || tryNo >= maxRetries) {
          throw failure instanceof Error || failure instanceof DOMException ? failure : new Error(String(failure))
        }
        await wait(backoff(tryNo), signal)
        tryNo++
        continue
      }

      report({})
      const ct = res.headers.get("content-type")
      const ra = retryAfterMs(res.headers.get("Retry-After"), now())
      if (res.status === 429) {
        const w = ra ?? backoff(rateLimits)
        rateLimits++
        if (rateLimits >= RATE_LIMIT_MAX || rateWaited + w > RATE_LIMIT_BUDGET_MS) throw new HttpError(429, url, ct)
        rateWaited += w
        cooldownUntil = Math.max(cooldownUntil, now() + w)
        if (patreon) slow = Math.min(slow * 2, 8)
        onWait?.(w, "rate-limit")
        continue // the cooldown gate does the waiting
      }
      rateLimits = 0
      if (!RETRYABLE(res.status) || tryNo >= maxRetries) throw new HttpError(res.status, url, ct)
      if (res.status === 503 && ra !== null) {
        cooldownUntil = Math.max(cooldownUntil, now() + ra)
        if (patreon) slow = Math.min(slow * 2, 8)
        onWait?.(ra, "unavailable")
      } else {
        await wait(ra ?? backoff(tryNo), signal)
      }
      tryNo++
    }
  }

  async function enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (active < concurrency) active++
    else await new Promise<void>((resolve) => waiters.push(resolve)) // the slot is handed over
    try {
      return await job()
    } finally {
      const next = waiters.shift()
      if (next) next()
      else active--
    }
  }

  const readJson = (url: string) => async (r: Response): Promise<unknown> => {
    const ct = r.headers.get("content-type")
    if (!ct || !/json/i.test(ct) || r.redirected) throw new NotJsonError(r.status, ct, url, r.redirected)
    // A SyntaxError here means a truncated body: retried like a network error.
    return JSON.parse(await r.text())
  }

  const readImage = (url: string) => async (r: Response): Promise<ArrayBuffer> => {
    const ct = r.headers.get("content-type")
    if (!ct || !/^image\//i.test(ct)) throw new NotImageError(ct, url)
    return r.arrayBuffer()
  }

  return {
    get slow() {
      return slow
    },
    getJson: (url) =>
      enqueue(async () => {
        const value = await attempt(url, "application/vnd.api+json, application/json", readJson(url), timeoutMs ?? 30_000, retries, true)
        onJson?.(url, value)
        return value
      }),
    getText: (url) => enqueue(() => attempt(url, "text/html", (r) => r.text(), timeoutMs ?? 30_000, retries, true)),
    getBytes: (url) => enqueue(() => attempt(url, "image/*", readImage(url), timeoutMs ?? 60_000, Math.min(1, retries), false)),
  }
}
