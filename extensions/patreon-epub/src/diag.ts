/**
 * In-memory diagnostics for remote debugging: a 300-line ring buffer the user
 * can copy from the panel and paste into a report. Logs request metadata
 * (path, query KEYS, status, content type, a few headers), listing strategy
 * outcomes, failed post ids, breaker events and API shape fingerprints (key
 * names only). Never cookies, bodies, titles or post content.
 */
import type { AttemptInfo } from "./http"

const MAX = 300
const lines: string[] = []
const shapes = new Set<string>()

const stamp = () => new Date().toISOString().slice(11, 23)

export function log(line: string): void {
  lines.push(`${stamp()} ${line}`)
  if (lines.length > MAX) lines.splice(0, lines.length - MAX)
}

/** `/api/posts?filter[collection_id]&sort` — path plus query keys, never values. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url)
    const keys = [...new Set(u.searchParams.keys())]
    return `${u.hostname === "www.patreon.com" ? "" : u.hostname}${u.pathname}${keys.length ? `?${keys.join("&")}` : ""}`
  } catch {
    return "(bad url)"
  }
}

export function logAttempt(a: AttemptInfo): void {
  const parts = [
    `http ${describeUrl(a.url)}`,
    `try=${a.tryNo}`,
    a.status !== undefined ? `status=${a.status}` : "",
    a.contentType ? `ct=${a.contentType.split(";")[0]}` : "",
    a.redirected ? "redirected" : "",
    a.cfMitigated ? `cf-mitigated=${a.cfMitigated}` : "",
    a.retryAfter ? `retry-after=${a.retryAfter}` : "",
    `${a.ms}ms`,
    a.error ? `error=${a.error}` : "",
  ]
  log(parts.filter(Boolean).join(" "))
}

const keysOf = (v: unknown): string[] =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? Object.keys(v).sort() : []

/** One line per distinct endpoint: the key names of the response, no values. */
export function logShape(url: string, json: unknown): void {
  const endpoint = describeUrl(url).replace(/\?.*/, "").replace(/\d+/g, ":id")
  if (shapes.has(endpoint)) return
  shapes.add(endpoint)
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>
  const data = Array.isArray(j.data) ? j.data[0] : j.data
  const attrs = typeof data === "object" && data !== null ? (data as Record<string, unknown>).attributes : undefined
  const included = Array.isArray(j.included)
    ? [...new Set(j.included.map((r) => (typeof r === "object" && r !== null ? String((r as Record<string, unknown>).type) : "?")))]
    : []
  log(
    `shape ${endpoint}: top=[${keysOf(j)}] attrs=[${keysOf(attrs)}] links=[${keysOf(j.links)}] meta=[${keysOf(j.meta)}] included=[${included}]`,
  )
}

export function text(): string {
  let version = "?"
  try {
    version = (globalThis as { chrome?: { runtime?: { getManifest?(): { version: string } } } }).chrome?.runtime?.getManifest?.().version ?? "?"
  } catch {
    // extension context gone
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "?"
  return [`patreon-epub ${version}`, `ua: ${ua}`, ...lines].join("\n")
}

/** For tests. */
export function reset(): void {
  lines.length = 0
  shapes.clear()
}
