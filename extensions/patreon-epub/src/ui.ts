/**
 * The floating "Download EPUB" panel, rendered in a closed Shadow DOM so
 * Patreon's CSS can't reach it (and ours can't leak out). Plain DOM, no
 * framework — it's a handful of states.
 */

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
.row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.row label { width: 40px; color: #52525b; font-size: 13px; }
select { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 6px; border: 1px solid #e4e4e7; border-radius: 6px; background: #fff; color: #0a0a0a; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.bar { height: 6px; background: #f4f4f5; border-radius: 99px; overflow: hidden; margin-top: 10px; }
.bar > div { height: 100%; width: 0; background: #18181b; transition: width .2s; }
.status { margin-top: 8px; font-size: 13px; word-break: break-word; }
.error { color: #b91c1c; }
.ok { color: #15803d; }
details { margin-top: 8px; font-size: 12px; color: #52525b; }
details ul { margin: 6px 0 0; padding-left: 18px; max-height: 140px; overflow: auto; }
`

export interface ChapterOption {
  label: string
}

export interface Skipped {
  title: string
  reason: string
}

export interface PanelHandlers {
  onOpen(): void
  onStart(from: number, to: number): void
  onCancel(): void
  onDownloadAgain(): void
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

  private frame(body: Child[], closable = true): HTMLDivElement {
    const head = el("div", { className: "head" }, el("span", { className: "title", textContent: "Download EPUB" }))
    if (closable) {
      head.append(el("button", { className: "close", title: "Close", textContent: "×", onclick: () => this.showButton() }))
    }
    return el("div", { className: "panel" }, head, ...body)
  }

  showButton(): void {
    this.setContent(
      el("button", { className: "fab primary", textContent: "Download EPUB", onclick: () => this.handlers.onOpen() }),
    )
  }

  showBusy(message: string): void {
    this.setContent(this.frame([el("div", { className: "status muted", textContent: message })]))
  }

  showReady(bookTitle: string, chapters: ChapterOption[], note?: string): void {
    const opts = () => chapters.map((c, i) => el("option", { value: String(i), textContent: `${i + 1}. ${c.label}` }))
    const from = el("select", {}, ...opts())
    const to = el("select", {}, ...opts())
    to.value = String(chapters.length - 1)
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
      el("div", { className: "row" }, el("label", { textContent: "From" }), from),
      el("div", { className: "row" }, el("label", { textContent: "To" }), to),
    ]
    if (note) body.push(el("div", { className: "status muted", textContent: note }))
    body.push(el("div", { className: "actions" }, start))
    this.setContent(this.frame(body))
  }

  private progressBar?: HTMLDivElement
  private progressText?: HTMLDivElement

  showProgress(): void {
    this.progressBar = el("div")
    this.progressText = el("div", { className: "status" })
    this.setContent(
      this.frame(
        [
          el("div", { className: "bar" }, this.progressBar),
          this.progressText,
          el("div", { className: "actions" }, el("button", { textContent: "Cancel", onclick: () => this.handlers.onCancel() })),
        ],
        false,
      ),
    )
  }

  setProgress(done: number, total: number, message: string): void {
    if (this.progressBar) this.progressBar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`
    if (this.progressText) this.progressText.textContent = message
  }

  showDone(filename: string, chapterCount: number, skipped: Skipped[], notes: string[]): void {
    const body: Child[] = [
      el("div", { className: "status ok", textContent: `Saved “${filename}” — ${chapterCount} chapters.` }),
    ]
    for (const n of notes) body.push(el("div", { className: "status muted", textContent: n }))
    if (skipped.length) {
      body.push(
        el(
          "details",
          { open: skipped.length <= 5 },
          el("summary", { textContent: `${skipped.length} post(s) skipped` }),
          el("ul", {}, ...skipped.map((s) => el("li", { textContent: `${s.title} — ${s.reason}` }))),
        ),
      )
    }
    body.push(
      el("div", { className: "actions" }, el("button", { textContent: "Download again", onclick: () => this.handlers.onDownloadAgain() })),
    )
    this.setContent(this.frame(body))
  }

  showError(message: string, retry?: () => void): void {
    const body: Child[] = [el("div", { className: "status error", textContent: message })]
    if (retry) body.push(el("div", { className: "actions" }, el("button", { textContent: "Try again", onclick: retry })))
    this.setContent(this.frame(body))
  }
}
