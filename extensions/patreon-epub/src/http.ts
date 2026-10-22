/**
 * A polite, sequential HTTP client: one request at a time, a jittered pause
 * between requests, and bounded retries with backoff on 429 / 5xx / network
 * errors. Uses the page's own cookies (`credentials: "include"`), so it can
 * read exactly what the logged-in user can read — nothing more.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${new URL(url).pathname}`)
    this.name = "HttpError"
  }
}

export interface HttpOptions {
  signal?: AbortSignal
  /** Pause between consecutive requests, in ms (jittered between min and max). */
  minDelayMs?: number
  maxDelayMs?: number
  /** Retries after the first attempt. */
  retries?: number
  /** Base backoff in ms; doubles per retry. */
  backoffMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
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

const RETRYABLE = (status: number) => status === 429 || status >= 500

/** Retry-After as ms (seconds or an HTTP date), capped at a minute. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const secs = Number(header)
  if (Number.isFinite(secs)) return Math.min(60_000, Math.max(0, secs * 1000))
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.min(60_000, Math.max(0, at - now))
}

export function createHttp(options: HttpOptions = {}): Http {
  const {
    signal,
    minDelayMs = 600,
    maxDelayMs = 900,
    retries = 3,
    backoffMs = 2000,
    fetchImpl = (...args: Parameters<typeof fetch>) => fetch(...args),
    sleep: wait = sleep,
    random = Math.random,
  } = options
  let lastRequestAt = 0
  // Requests are chained so callers can't accidentally run them in parallel.
  let queue: Promise<unknown> = Promise.resolve()

  async function attempt(url: string, accept: string): Promise<Response> {
    for (let tryNo = 0; ; tryNo++) {
      if (signal?.aborted) throw abortError()
      const gap = minDelayMs + random() * (maxDelayMs - minDelayMs)
      const waitFor = lastRequestAt ? lastRequestAt + gap - Date.now() : 0
      if (waitFor > 0) await wait(waitFor, signal)
      lastRequestAt = Date.now()

      let res: Response | null = null
      let networkError: unknown = null
      try {
        res = await fetchImpl(url, {
          // Cookies only go to Patreon itself; a CDN image is fetched anonymously
          // (credentialed CORS requests to a wildcard-CORS CDN would fail).
          credentials: url.startsWith("https://www.patreon.com/") ? "include" : "omit",
          headers: { Accept: accept },
          signal,
        })
      } catch (e) {
        if (isAbort(e) || signal?.aborted) throw abortError()
        networkError = e
      }
      if (res?.ok) return res
      const retryable = networkError !== null || (res !== null && RETRYABLE(res.status))
      if (!retryable || tryNo >= retries) {
        if (res) throw new HttpError(res.status, url)
        throw networkError instanceof Error ? networkError : new Error(String(networkError))
      }
      const fromHeader = res ? retryAfterMs(res.headers.get("Retry-After")) : null
      const backoff = fromHeader ?? backoffMs * 2 ** tryNo * (1 + random() * 0.25)
      await wait(backoff, signal)
    }
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job)
    queue = run.catch(() => undefined)
    return run
  }

  return {
    getJson: (url) =>
      enqueue(async () => (await attempt(url, "application/vnd.api+json, application/json")).json()),
    getText: (url) => enqueue(async () => (await attempt(url, "text/html")).text()),
    getBytes: (url) => enqueue(async () => (await attempt(url, "image/*")).arrayBuffer()),
  }
}
