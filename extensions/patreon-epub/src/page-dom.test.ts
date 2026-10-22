/**
 * DOM helpers against a tiny fake DOM (the repo has no jsdom and no new
 * dependencies are allowed): just enough of Element for these functions.
 */
import { describe, it, expect } from "vitest"

import { bookFilename } from "./build"
import { findLoadMore, pagePostIds } from "./page-dom"

interface FakeEl {
  tag: string
  attrs: Record<string, string>
  textContent: string
  disabled?: boolean
  visible?: boolean
  href?: string
  parentElement: FakeEl | null
  children: FakeEl[]
}

function h(tag: string, attrs: Record<string, string> = {}, text = "", children: FakeEl[] = [], extra: Partial<FakeEl> = {}): FakeEl {
  const node: FakeEl = { tag, attrs, textContent: text, visible: true, parentElement: null, children, ...extra }
  if (attrs.href) node.href = new URL(attrs.href, "https://www.patreon.com").href
  for (const c of children) c.parentElement = node
  return node
}

const all = (n: FakeEl): FakeEl[] => [n, ...n.children.flatMap(all)]

/** Wrap fake nodes in the bits of the Element API the helpers use. */
function wrap(n: FakeEl): HTMLElement {
  const el = {
    get href() {
      return n.href ?? ""
    },
    get textContent() {
      return n.textContent
    },
    get disabled() {
      return n.disabled ?? false
    },
    getAttribute: (k: string) => n.attrs[k] ?? null,
    getClientRects: () => (n.visible ? [{}] : []),
    get parentElement() {
      return n.parentElement ? wrap(n.parentElement) : null
    },
    contains: (o: { __n: FakeEl }) => all(n).includes(o.__n),
    closest: (sel: string) => {
      const tags = sel.split(",").map((s) => s.trim())
      for (let p: FakeEl | null = n; p; p = p.parentElement) if (tags.includes(p.tag)) return wrap(p)
      return null
    },
    __n: n,
  }
  return el as unknown as HTMLElement
}

function root(tree: FakeEl, match: (n: FakeEl) => boolean): ParentNode {
  return { querySelectorAll: () => all(tree).filter(match).map(wrap) } as unknown as ParentNode
}

const clickable = (n: FakeEl) =>
  n.tag === "button" || n.attrs.role === "button" || (n.tag === "a" && (!n.attrs.href || n.attrs.href === "#"))

describe("findLoadMore", () => {
  it("matches a German label", () => {
    const tree = h("div", {}, "", [h("button", {}, "Abonnieren"), h("button", {}, "  Mehr laden ")])
    expect(findLoadMore(root(tree, clickable))?.textContent).toContain("Mehr laden")
  })
  it("matches a [role=button] div and a data-tag, skipping disabled or hidden ones", () => {
    const div = h("div", { role: "button" }, "Show more posts")
    expect(findLoadMore(root(h("main", {}, "", [div]), clickable))?.textContent).toBe("Show more posts")
    const tagged = h("button", { "data-tag": "load-more-button" }, "↓")
    const disabled = h("button", {}, "Load more", [], { disabled: true })
    const hidden = h("button", {}, "Load more", [], { visible: false })
    expect(findLoadMore(root(h("main", {}, "", [disabled, hidden, tagged]), clickable))?.getAttribute("data-tag")).toBe("load-more-button")
  })
  it("returns null when nothing matches", () => {
    expect(findLoadMore(root(h("main", {}, "", [h("button", {}, "Join")]), clickable))).toBeNull()
  })
})

describe("pagePostIds", () => {
  const isPostLink = (n: FakeEl) => n.tag === "a" && !!n.attrs.href?.includes("/posts/")
  it("uses untagged links from the main container, not the nav", () => {
    const list = h("section", {}, "", [h("a", { href: "/posts/c-3" }), h("a", { href: "/posts/c-2" }), h("a", { href: "/posts/c-1?x=1" })])
    const tree = h("body", {}, "", [h("nav", {}, "", [h("a", { href: "/posts/99" })]), h("main", {}, "", [list])])
    expect(pagePostIds("9", root(tree, isPostLink))).toEqual({ ids: ["3", "2", "1"], source: "page-untagged" })
  })
  it("prefers tagged links", () => {
    const tree = h("main", {}, "", [h("a", { href: "/posts/5?collection=9" }), h("a", { href: "/posts/6" })])
    expect(pagePostIds("9", root(tree, isPostLink))).toEqual({ ids: ["5"], source: "page" })
  })
})

describe("bookFilename", () => {
  it("keeps the range on a long title", () => {
    const name = bookFilename("x".repeat(130), [51, 100])
    expect(name.endsWith(" (51-100).epub")).toBe(true)
    expect(name.length).toBeLessThanOrEqual(125)
    expect(bookFilename("Book")).toBe("Book.epub")
  })
})
