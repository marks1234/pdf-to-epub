/**
 * Service worker: fetches the cover image, which lives on Royal Road's CDN
 * (another origin, so the content script's own fetch would hit CORS).
 */
declare const chrome: {
  runtime: {
    onMessage: {
      addListener(
        cb: (msg: { type?: string; url?: string }, sender: unknown, reply: (r: { ok: boolean; base64?: string }) => void) => boolean | void,
      ): void
    }
  }
}

const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(royalroad\.com|royalroadcdn\.com)\//i

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "cover" || !msg.url || !ALLOWED.test(msg.url)) return
  void (async () => {
    try {
      const res = await fetch(msg.url!, { credentials: "omit" })
      if (!res.ok) return reply({ ok: false })
      const bytes = new Uint8Array(await res.arrayBuffer())
      let s = ""
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      reply({ ok: true, base64: btoa(s) })
    } catch {
      reply({ ok: false })
    }
  })()
  return true
})
