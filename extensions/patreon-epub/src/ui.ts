/**
 * The floating "Download EPUB" panel, rendered in a closed Shadow DOM so
 * Patreon's CSS can't reach it (and ours can't leak out). Plain DOM, no
 * framework — it's a handful of states.
 */
import type { FailureKind } from "./posts"

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #0a0a0a;
}
button {
  font: inherit; cursor: pointer; border-radius: 8px; padding: 8px 14px;
  border: 1px solid #e4e4e7; background: #fff; color: #0a0a0a;
}
button:hover { background: #f4f4f5; }
button.primary { background: #18181b; color: #fafafa; border-color: #18181b; }
button.primary:hover { background: #27272a; }
button.link { border: 0; padding: 2px 0; background: transparent; color: #52525b; text-decoration: underline; font-size: 12px; }
button:disabled { opacity: .5; cursor: default; }
.fab { box-shadow: 0 4px 16px rgba(0,0,0,.18); font-weight: 600; }
.panel {
  width: 340px; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,.18); padding: 14px 16px;
}
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.title { font-weight: 600; font-size: 15px; }
.close { border: 0; padding: 2px 8px; font-size: 18px; line-height: 1; background: transparent; }
.muted { color: #71717a; font-size: 13px; }
.warn { color: #b45309; font-size: 13px; }
.row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.row label { width: 40px; color: #52525b; font-size: 13px; }
select { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 6px; border: 1px solid #e4e4e7; border-radius: 6px; background: #fff; color: #0a0a0a; }
.actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 14px; }
.bar { height: 6px; background: #f4f4f5; border-radius: 99px; overflow: hidden; margin-top: 10px; }
.bar > div { height: 100%; width: 0; background: #18181b; transition: width .2s; }
.status { margin-top: 8px; font-size: 13px; word-break: break-word; }
.error { color: #b91c1c; }
.ok { color: #15803d; }
details { margin-top: 8px; font-size: 12px; color: #52525b; }
details ul { margin: 6px 0 0; padding-left: 18px; max-height: 140px; overflow: auto; }
textarea { width: 100%; height: 120px; margin-top: 8px; font: 11px/1.3 ui-monospace, monospace; }
`

export interface ChapterOption {
  label: string
}

export interface Skipped {
  title: string
  reason: string
  kind?: FailureKind
}

export interface ReadyInfo {
  /** Chapters already saved (cache), shown as "N of M already saved". */
  saved?: number
  onClearSaved?(): void
  /** Lines shown in amber (e.g. an incomplete listing). */
  warnings?: string[]
  /** Range to preselect. */
  range?: [number, number]
}

export interface PanelHandlers {
  onOpen(): void
  onStart(from: number, to: number): void
  onCancel(): void
  onDownloadAgain(): void
  /** Text for the "Copy diagnostics" button. */
  diagnostics?(): string
}

type Child = Node | string

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const c of children) node.append(c)
  return node
}

const TEMPORARY = new Set<FailureKind | undefined>(["transient", "auth"])

export class Panel {
  readonly root: ShadowRoot
  private readonly host: HTMLElement
  private readonly wrap: HTMLDivElement

  constructor(private readonly handlers: PanelHandlers) {
    this.host = document.createElement("patreon-epub-panel")
    this.root = this.host.attachShadow({ mode: "closed" })
    this.root.append(el("style", { textContent: CSS }))
    this.wrap = el("div", { className: "wrap" })
    this.root.append(this.wrap)
    document.documentElement.append(this.host)
    this.showButton()
  }

  destroy(): void {
    this.host.remove()
  }

  private setContent(...children: Child[]): void {
    this.wrap.replaceChildren(...children)
  }

  private frame(body: Child[], onClose: (() => void) | null = () => this.showButton()): HTMLDivElement {
    const head = el("div", { className: "head" }, el("span", { className: "title", textContent: "Download EPUB" }))
    if (onClose) head.append(el("button", { className: "close", title: "Close", textContent: "×", onclick: onClose }))
    return el("div", { className: "panel" }, head, ...body)
  }

  /** "Copy diagnostics": clipboard, else a selected read-only textarea in the panel. */
  private diagButton(container: () => HTMLElement): HTMLButtonElement | null {
    const get = this.handlers.diagnostics
    if (!get) return null
    const button = el("button", {
      className: "link",
      textContent: "Copy diagnostics",
      onclick: async () => {
        const text = get()
        try {
          await navigator.clipboard.writeText(text)
          button.textContent = "Copied — paste it into your report"
        } catch {
          const area = el("textarea", { readOnly: true, value: text })
          container().append(area)
          area.select()
          button.textContent = "Copy the text below"
        }
      },
    })
    return button
  }

  showButton(): void {
    this.setContent(
      el("button", { className: "fab primary", textContent: "Download EPUB", onclick: () => this.handlers.onOpen() }),
    )
  }

  /** A listing in progress; × cancels it. */
  showBusy(message: string): void {
    this.setContent(
      this.frame([el("div", { className: "status muted", textContent: message })], () => this.handlers.onCancel()),
    )
  }

  showReady(bookTitle: string, chapters: ChapterOption[], note?: string, info: ReadyInfo = {}): void {
    const opts = () => chapters.map((c, i) => el("option", { value: String(i), textContent: `${i + 1}. ${c.label}` }))
    const from = el("select", {}, ...opts())
    const to = el("select", {}, ...opts())
    const [a0, b0] = info.range && info.range[1] < chapters.length ? info.range : [0, chapters.length - 1]
    from.value = String(a0)
    to.value = String(b0)
    const start = el("button", {
      className: "primary",
      textContent: "Start",
      onclick: () => {
        const a = Number(from.value)
        const b = Number(to.value)
        this.handlers.onStart(Math.min(a, b), Math.max(a, b))
      },
    })
    const body: Child[] = [
      el("div", { textContent: bookTitle }),
      el("div", { className: "muted", textContent: `${chapters.length} chapters found` }),
    ]
    for (const w of info.warnings ?? []) body.push(el("div", { className: "status warn", textContent: w }))
    if (info.saved) {
      const line = el("div", {
        className: "status muted",
        textContent: `${info.saved} of ${chapters.length} already saved — fetching only the rest. `,
      })
      if (info.onClearSaved) {
        line.append(el("button", { className: "link", textContent: "Clear saved chapters", onclick: () => info.onClearSaved?.() }))
      }
      body.push(line)
    }
    body.push(
      el("div", { className: "row" }, el("label", { textContent: "From" }), from),
      el("div", { className: "row" }, el("label", { textContent: "To" }), to),
    )
    if (note) body.push(el("div", { className: "status muted", textContent: note }))
    const actions = el("div", { className: "actions" })
    const frame = this.frame([...body, actions])
    if (info.warnings?.length) {
      const d = this.diagButton(() => frame)
      if (d) actions.append(d)
    }
    actions.append(start)
    this.setContent(frame)
  }

  private progressBar?: HTMLDivElement
  private progressText?: HTMLDivElement
  private pauseText?: HTMLDivElement

  showProgress(): void {
    this.progressBar = el("div")
    this.progressText = el("div", { className: "status" })
    this.pauseText = el("div", { className: "status warn" })
    const cancel = el("button", {
      textContent: "Cancel",
      onclick: () => {
        cancel.disabled = true
        if (this.progressText) this.progressText.textContent = "Cancelling…"
        this.handlers.onCancel()
      },
    })
    this.setContent(
      this.frame(
        [el("div", { className: "bar" }, this.progressBar), this.progressText, this.pauseText, el("div", { className: "actions" }, cancel)],
        null,
      ),
    )
  }

  setProgress(done: number, total: number, message: string): void {
    if (this.progressBar) this.progressBar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`
    if (this.progressText) this.progressText.textContent = message
  }

  /** A pause / slow-down notice under the progress bar; null clears it. */
  setPause(message: string | null): void {
    if (this.pauseText) this.pauseText.textContent = message ?? ""
  }

  showDone(filename: string, chapterCount: number, skipped: Skipped[], notes: string[], onRetry?: () => void): void {
    const body: Child[] = [
      el("div", {
        className: "status ok",
        textContent: `Built “${filename}” (${chapterCount} chapters). If no download appeared, click Download again.`,
      }),
    ]
    for (const n of notes) body.push(el("div", { className: "status muted", textContent: n }))
    const temporary = skipped.filter((s) => TEMPORARY.has(s.kind))
    const excluded = skipped.filter((s) => !TEMPORARY.has(s.kind))
    const list = (summary: string, items: Skipped[], open: boolean) =>
      el(
        "details",
        { open },
        el("summary", { textContent: summary }),
        el("ul", {}, ...items.map((s) => el("li", { textContent: `${s.title} — ${s.reason}` }))),
      )
    if (temporary.length) body.push(list(`Couldn't download (temporary): ${temporary.length}`, temporary, true))
    if (excluded.length) body.push(list(`Not included (locked / missing / empty): ${excluded.length}`, excluded, excluded.length <= 5))
    const actions = el("div", { className: "actions" })
    const frame = this.frame([...body, actions])
    const d = skipped.length || notes.length ? this.diagButton(() => frame) : null
    if (d) actions.append(d)
    actions.append(el("button", { textContent: "Download again", onclick: () => this.handlers.onDownloadAgain() }))
    if (temporary.length && onRetry) {
      actions.append(el("button", { className: "primary", textContent: `Retry ${temporary.length} failed posts`, onclick: onRetry }))
    }
    this.setContent(frame)
  }

  showError(message: string, retry?: () => void): void {
    const actions = el("div", { className: "actions" })
    const frame = this.frame([el("div", { className: "status error", textContent: message }), actions])
    const d = this.diagButton(() => frame)
    if (d) actions.append(d)
    if (retry) actions.append(el("button", { className: "primary", textContent: "Try again", onclick: retry }))
    this.setContent(frame)
  }

  /**
   * Save a blob. The anchor lives inside the closed shadow root and stops its
   * click from propagating, so Patreon's SPA router never sees (or swallows) it.
   */
  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = el("a", { href: url, download: filename })
    a.style.display = "none"
    a.addEventListener("click", (e) => e.stopPropagation())
    this.wrap.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
