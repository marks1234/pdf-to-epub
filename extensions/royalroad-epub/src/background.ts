/**
 * Service worker: fetches on behalf of the content script.
 * - "cover": the cover image, on Royal Road's CDN (another origin, so the
 *   content script's own fetch would hit CORS).
 * - "html": a Royal Road page. Fetched from here rather than the page, after
 *   copying the reader's partitioned cookies (e.g. the Cloudflare clearance
 *   they earned by passing the check) to unpartitioned ones, since Chrome
 *   leaves partitioned cookies off extension fetches. Same approach as WebToEpub.
 */
type Cookie = {
  name: string; value: string; domain: string; path: string; secure: boolean
  httpOnly: boolean; sameSite?: string; expirationDate?: number; hostOnly?: boolean; partitionKey?: unknown
}
type Msg = { type?: string; url?: string }
type Reply = { ok: boolean; base64?: string; status?: number; text?: string; cfMitigated?: boolean; retryAfter?: number }

declare const chrome: {
  runtime: {
    onMessage: { addListener(cb: (msg: Msg, sender: unknown, reply: (r: Reply) => void) => boolean | void): void }
  }
  cookies: {
    getAll(details: { domain: string; partitionKey?: object }): Promise<Cookie[]>
    set(details: Record<string, unknown>): Promise<unknown>
  }
}

const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(royalroad\.com|royalroadcdn\.com)\//i
const PAGE = /^https:\/\/www\.royalroad\.com\//i

async function unpartitionCookies(): Promise<void> {
  try {
    const all = await chrome.cookies.getAll({ domain: "royalroad.com", partitionKey: {} })
    await Promise.all(
      all
        .filter((c) => c.partitionKey != null)
        .map((c) =>
          chrome.cookies.set({
            url: `https://${c.domain.replace(/^\./, "")}${c.path}`,
            name: c.name,
            value: c.value,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
            ...(c.hostOnly ? {} : { domain: c.domain }),
          }).catch(() => undefined),
        ),
    )
  } catch {
    // Browser without partitioned-cookie support: nothing to copy.
  }
}

async function fetchCover(url: string): Promise<Reply> {
  const res = await fetch(url, { credentials: "omit" })
  if (!res.ok) return { ok: false }
  const bytes = new Uint8Array(await res.arrayBuffer())
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { ok: true, base64: btoa(s) }
}

async function fetchHtml(url: string): Promise<Reply> {
  await unpartitionCookies()
  const res = await fetch(url, { credentials: "include" })
  return {
    ok: res.ok,
    status: res.status,
    text: res.ok ? await res.text() : undefined,
    cfMitigated: !!res.headers.get("cf-mitigated"),
    retryAfter: Number(res.headers.get("retry-after")) || undefined,
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg?.url) return
  const job =
    msg.type === "cover" && ALLOWED.test(msg.url) ? fetchCover(msg.url)
    : msg.type === "html" && PAGE.test(msg.url) ? fetchHtml(msg.url)
    : null
  if (!job) return
  job.then(reply, () => reply({ ok: false, status: 0 }))
  return true
})
