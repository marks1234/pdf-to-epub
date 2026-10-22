/**
 * Panel.download against a minimal fake DOM (no jsdom in this repo): the
 * anchor must live in the panel's shadow root and stop its click from
 * propagating, so a document-level SPA router never sees an `a[href]` target.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"

import { Panel } from "./ui"

type Listener = (e: FakeEvent) => void
interface FakeEvent {
  target: FakeNode
  stopped: boolean
  stopPropagation(): void
}

class FakeNode {
  children: FakeNode[] = []
  parent: FakeNode | null = null
  listeners: Record<string, Listener[]> = {}
  style: Record<string, string> = {}
  isShadowRoot = false
  constructor(readonly tag: string) {}
  append(...nodes: (FakeNode | string)[]) {
    for (const n of nodes) {
      if (typeof n === "string") continue
      this.children.push(n)
      n.parent = this
    }
  }
  replaceChildren(...nodes: (FakeNode | string)[]) {
    this.children = []
    this.append(...nodes)
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this)
    this.parent = null
  }
  attachShadow() {
    const r = new FakeNode("#shadow")
    r.isShadowRoot = true
    return r
  }
  addEventListener(type: string, l: Listener) {
    ;(this.listeners[type] ??= []).push(l)
  }
  /** Bubble a click; a shadow root retargets to its host's outside world as the host. */
  click() {
    const e: FakeEvent = { target: this, stopped: false, stopPropagation: () => (e.stopped = true) }
    this.listeners.click?.forEach((l) => l(e))
    for (let n = this.parent; n && !e.stopped; n = n.parent) n.listeners.click?.forEach((l) => l(e))
    if (!e.stopped) docListeners.forEach((l) => l(e))
  }
  closest(sel: string) {
    return sel === "a[href]" && this.tag === "a" ? this : null
  }
}

let docListeners: Listener[] = []

beforeEach(() => {
  docListeners = []
  const documentElement = new FakeNode("html")
  vi.stubGlobal("document", {
    documentElement,
    createElement: (tag: string) => new FakeNode(tag),
    addEventListener: (_: string, l: Listener) => docListeners.push(l),
  })
  vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() }))
})
afterEach(() => vi.unstubAllGlobals())

describe("Panel.download", () => {
  it("a document-level router sees no a[href] target", () => {
    const panel = new Panel({ onOpen() {}, onStart() {}, onCancel() {}, onDownloadAgain() {} })
    const seen: unknown[] = []
    document.addEventListener("click", ((e: FakeEvent) => seen.push(e.target.closest("a[href]"))) as never)
    panel.download(new Blob(["x"]), "Book.epub")
    expect(seen).toEqual([])
    expect((panel.root as unknown as FakeNode).isShadowRoot).toBe(true)
  })
})
