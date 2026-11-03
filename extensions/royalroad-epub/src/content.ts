/**
 * Content script on https://www.royalroad.com/fiction/* pages: a small panel
 * (bottom right) that fetches the fiction's chapters one at a time, through
 * the reader's own browser session, and downloads them as one EPUB.
 */
import type { Chapter } from "@/lib/epub-book"

import { bodyToChapter, bookFilename, buildBook } from "./book"
import {
  fictionIdFromPath,
  isFictionOverview,
  parseChapter,
  parseChapterList,
  parseFictionMeta,
  type ChapterRef,
  type FictionMeta,
} from "./parse"

declare const chrome: {
  runtime: {
    sendMessage(msg: unknown): Promise<
      { ok: boolean; base64?: string; status?: number; text?: string; cfMitigated?: boolean; retryAfter?: number } | undefined
    >
  }
}

/** Gap between chapter requests; Royal Road rate-limits fast clients. */
const GAP_MS = 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class StopError extends Error {}

/** Fetches a Royal Road page via the service worker (see background.ts). */
async function getHtml(url: string, signal: AbortSignal): Promise<string> {
  const abs = new URL(url, location.href).href
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) throw new StopError("Cancelled.")
    const res = await chrome.runtime.sendMessage({ type: "html", url: abs })
    if (signal.aborted) throw new StopError("Cancelled.")
    if (res?.ok && res.text != null) return res.text
    const status = res?.status ?? 0
    if (status === 403 && res?.cfMitigated) {
      throw new StopError(
        "Royal Road's Cloudflare check blocked the download. Open any chapter in a normal tab, pass the \"are you human\" check if shown, then come back, reload this page and click Start again — chapters already fetched are kept.",
      )
    }
    if ((status === 0 || status === 429 || status >= 500) && attempt < 5) {
      const after = res?.retryAfter
      await sleep(after && after > 0 ? Math.min(after, 60) * 1000 : 5000 * attempt)
      continue
    }
    throw new Error(`HTTP ${status}`)
  }
}

async function fetchCover(url: string | undefined): Promise<Uint8Array | undefined> {
  if (!url) return undefined
  try {
    const abs = new URL(url, location.href).href
    const r = await chrome.runtime.sendMessage({ type: "cover", url: abs })
    if (!r?.ok || !r.base64) return undefined
    const bin = atob(r.base64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return undefined
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ── UI ───────────────────────────────────────────────────────────────────────

const CSS = `
:host { all: initial; }
.box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font: 14px/1.4 system-ui, sans-serif;
  background: #1f2430; color: #eef; border-radius: 10px; box-shadow: 0 6px 24px #0008; padding: 12px 14px; width: 300px; }
.box.min { width: auto; padding: 0; background: none; box-shadow: none; }
button { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 6px 12px; background: #3b82f6; color: #fff; }
button.secondary { background: #444b5c; }
button:disabled { opacity: .5; cursor: default; }
.row { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
input[type=number] { width: 64px; font: inherit; padding: 3px 4px; border-radius: 4px; border: 1px solid #556; background: #11151d; color: #eef; }
.muted { color: #aab; font-size: 12px; }
.bar { height: 6px; background: #333a48; border-radius: 3px; overflow: hidden; margin-top: 8px; }
.bar > i { display: block; height: 100%; background: #3b82f6; width: 0; transition: width .2s; }
.err { color: #fca5a5; }
h3 { margin: 0 0 4px; font-size: 14px; }
`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...kids)
  return e
}

class Panel {
  private box: HTMLDivElement
  private meta: FictionMeta | null = null
  private list: ChapterRef[] = []
  private done = new Map<string, Chapter>()
  private ctrl: AbortController | null = null

  constructor(private fictionId: string) {
    const host = el("div")
    const root = host.attachShadow({ mode: "open" })
    root.append(el("style", { textContent: CSS }))
    this.box = el("div", { className: "box min" })
    root.append(this.box)
    document.documentElement.append(host)
    this.showLauncher()
  }

  private set(...kids: (Node | string)[]) {
    this.box.className = "box"
    this.box.replaceChildren(...kids)
  }

  private showLauncher() {
    this.box.className = "box min"
    this.box.replaceChildren(el("button", { textContent: "📖 Download EPUB", onclick: () => void this.load() }))
  }

  private async load() {
    this.set(el("div", { textContent: "Reading the chapter list…" }))
    try {
      const ctrl = new AbortController()
      const html = isFictionOverview(location.pathname)
        ? document.documentElement.outerHTML
        : await getHtml(`/fiction/${this.fictionId}`, ctrl.signal)
      this.meta = parseFictionMeta(html, this.fictionId)
      this.list = parseChapterList(html)
      if (!this.list.length) throw new Error("No chapters found on the fiction page.")
      this.showReady()
    } catch (e) {
      this.showError(e)
    }
  }

  private showReady() {
    const n = this.list.length
    const from = el("input", { type: "number", min: "1", max: String(n), value: "1" })
    const to = el("input", { type: "number", min: "1", max: String(n), value: String(n) })
    const notes = el("input", { type: "checkbox", checked: true })
    const saved = this.done.size ? ` · ${this.done.size} already fetched` : ""
    this.set(
      el("h3", { textContent: this.meta!.title }),
      el("div", { className: "muted", textContent: `by ${this.meta!.author} · ${n} chapters${saved}` }),
      el("div", { className: "row" }, "From", from, "to", to),
      el("label", { className: "row" }, notes, "Include author's notes"),
      el(
        "div",
        { className: "row" },
        el("button", {
          textContent: "Start",
          onclick: () => {
            const a = Math.max(1, Math.min(n, Math.floor(Number(from.value) || 1)))
            const b = Math.max(a, Math.min(n, Math.floor(Number(to.value) || n)))
            void this.run(a, b, notes.checked)
          },
        }),
        el("button", { className: "secondary", textContent: "Close", onclick: () => this.showLauncher() }),
      ),
    )
  }

  private async run(a: number, b: number, authorNotes: boolean) {
    const ctrl = (this.ctrl = new AbortController())
    const slice = this.list.slice(a - 1, b)
    const status = el("div")
    const bar = el("i")
    const failed: ChapterRef[] = []
    this.set(
      el("h3", { textContent: this.meta!.title }),
      status,
      el("div", { className: "bar" }, bar),
      el("div", { className: "row" }, el("button", { className: "secondary", textContent: "Cancel", onclick: () => ctrl.abort() })),
    )
    const total = slice.length
    try {
      let fetchedAny = false
      for (let i = 0; i < total; i++) {
        if (ctrl.signal.aborted) throw new StopError("Cancelled. Chapters already fetched are kept.")
        const ref = slice[i]
        status.textContent = `Chapter ${i + 1} of ${total}: ${ref.title}`
        bar.style.width = `${(i / total) * 100}%`
        const key = `${ref.id}|${authorNotes}`
        if (this.done.has(key)) continue
        if (fetchedAny) await sleep(GAP_MS)
        fetchedAny = true
        try {
          const body = parseChapter(await getHtml(ref.url, ctrl.signal))
          this.done.set(key, bodyToChapter(ref.title, body, { authorNotes }))
        } catch (e) {
          if (e instanceof StopError) throw e
          console.warn("[royalroad-epub] chapter failed", ref.url, e)
          failed.push(ref)
        }
      }
      bar.style.width = "100%"
      status.textContent = "Building the EPUB…"
      const chapters = slice.map((r) => this.done.get(`${r.id}|${authorNotes}`)).filter((c): c is Chapter => !!c)
      if (!chapters.length) throw new Error("No chapters could be downloaded.")
      const blob = await buildBook(this.meta!, chapters, await fetchCover(this.meta!.coverUrl))
      const name = bookFilename(this.meta!.title, a === 1 && b === this.list.length ? undefined : [a, b])
      download(blob, name)
      this.set(
        el("h3", { textContent: "Done ✓" }),
        el("div", { textContent: `${name} — ${chapters.length} chapters, ${(blob.size / 1e6).toFixed(1)} MB` }),
        failed.length
          ? el("div", { className: "err", textContent: `${failed.length} chapter(s) failed: ${failed.slice(0, 5).map((f) => f.title).join(", ")}${failed.length > 5 ? "…" : ""}` })
          : "",
        el("div", { className: "muted", textContent: "Send it to your Kindle at amazon.com/sendtokindle." }),
        el(
          "div",
          { className: "row" },
          el("button", { textContent: "Download again", onclick: () => download(blob, name) }),
          failed.length ? el("button", { textContent: "Retry failed", onclick: () => void this.run(a, b, authorNotes) }) : "",
          el("button", { className: "secondary", textContent: "Close", onclick: () => this.showLauncher() }),
        ),
      )
    } catch (e) {
      this.showError(e)
    }
  }

  private showError(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    this.set(
      el("div", { className: "err", textContent: msg }),
      el(
        "div",
        { className: "row" },
        el("button", { textContent: "Back", onclick: () => (this.list.length ? this.showReady() : void this.load()) }),
        el("button", { className: "secondary", textContent: "Close", onclick: () => this.showLauncher() }),
      ),
    )
  }
}

const id = fictionIdFromPath(location.pathname)
if (id) new Panel(id)
