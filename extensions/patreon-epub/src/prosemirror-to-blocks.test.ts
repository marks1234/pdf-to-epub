import { describe, it, expect } from "vitest"

import type { Http } from "./http"
import { postToChapter } from "./build"
import { prosemirrorJsonToBlocks, prosemirrorToBlocks } from "./prosemirror-to-blocks"
import { fetchPostContent } from "./posts"

const doc = (...content: unknown[]) => ({ type: "doc", content })
const p = (...content: unknown[]) => ({ type: "paragraph", content })
const t = (text: string, ...marks: string[]) => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })

describe("prosemirrorToBlocks", () => {
  it("plain paragraphs, skipping empty ones", () => {
    expect(prosemirrorToBlocks(doc(p(), p(t("“This way,” Tryfinger said.")), { type: "paragraph" }, p(t("Next."))))).toEqual([
      { type: "p", text: "“This way,” Tryfinger said." },
      { type: "p", text: "Next." },
    ])
  })

  it("a bold+italic System line and mixed marks", () => {
    const [sys, mixed] = prosemirrorToBlocks(
      doc(p(t("[Skill gained]", "bold", "italic")), p(t("He said "), t("no", "em"), t(" and "), t("left", "strong", "underline", "strike"), t("."))),
    )
    expect(sys).toEqual({ type: "p", text: "[Skill gained]", runs: [{ text: "[Skill gained]", marks: ["b", "i"] }] })
    expect(mixed.text).toBe("He said no and left.")
    expect(mixed.runs).toEqual([
      { text: "He said " },
      { text: "no", marks: ["i"] },
      { text: " and " },
      { text: "left", marks: ["b", "s", "u"] },
      { text: "." },
    ])
  })

  it("alignment, headings (clamped), hardBreak, links keep text", () => {
    const blocks = prosemirrorToBlocks(
      doc(
        { type: "paragraph", attrs: { textAlign: "center" }, content: [t("Centered")] },
        { type: "heading", attrs: { level: 6 }, content: [t("Title")] },
        p(t("a"), { type: "hardBreak" }, t("b", "link")),
      ),
    )
    expect(blocks[0]).toEqual({ type: "p", text: "Centered", align: "center" })
    expect(blocks[1]).toEqual({ type: "p", text: "Title", role: "h4" })
    expect(blocks[2]).toEqual({ type: "p", text: "a b", runs: [{ text: "a" }, { text: "", br: true }, { text: "b" }] })
  })

  it("lists, blockquotes, horizontal rules and text scene breaks", () => {
    const blocks = prosemirrorToBlocks(
      doc(
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }, { type: "listItem", content: [p(t("two"))] }] },
        { type: "blockquote", content: [p(t("quoted"))] },
        { type: "horizontalRule" },
        p(t("* * *")),
      ),
    )
    expect(blocks).toEqual([
      { type: "li", text: "one" },
      { type: "li", text: "two" },
      { type: "p", text: "quoted", role: "blockquote" },
      { type: "hr", text: "* * *" },
      { type: "hr", text: "* * *" },
    ])
  })

  it("keeps the text of unknown nodes and never throws", () => {
    const blocks = prosemirrorToBlocks(doc({ type: "callout", content: [p(t("inside"))] }, p(t("x "), { type: "mention", text: "@Writer" }), 5, null))
    expect(blocks.map((b) => b.text)).toEqual(["inside", "x @Writer"])
    expect(prosemirrorToBlocks(null)).toEqual([])
  })

  it("malformed JSON gives null", () => {
    expect(prosemirrorJsonToBlocks("{not json")).toBeNull()
    expect(prosemirrorJsonToBlocks(JSON.stringify(doc(p())))).toBeNull()
  })
})

describe("posts with content:null + content_json_string", () => {
  const httpFor = (body: unknown): Http => ({
    getJson: async () => body,
    getText: async () => {
      throw new Error("no page")
    },
    getBytes: async () => new ArrayBuffer(0),
  })

  it("become chapters, not skips", async () => {
    const json = JSON.stringify(doc(p(), p(t("“This way,” Tryfinger said."))))
    const r = await fetchPostContent(
      { id: "1" },
      httpFor({ data: { id: "1", attributes: { title: "Ch 1", content: null, content_json_string: json, current_user_can_view: true } } }),
    )
    expect(r.ok).toBe(true)
    const chapter = r.ok ? postToChapter(r) : null
    expect(chapter?.blocks).toEqual([{ type: "p", text: "“This way,” Tryfinger said." }])
  })

  it("malformed json falls back without throwing", async () => {
    const r = await fetchPostContent(
      { id: "1" },
      httpFor({ data: { id: "1", attributes: { title: "Ch 1", content: null, content_json_string: "{oops" } } }),
    )
    expect(r.ok).toBe(false)
  })
})
