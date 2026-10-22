import { describe, it, expect } from "vitest"

import { blocksToHtml } from "@/lib/reconstruct"

import { decodeEntities, htmlToBlocks } from "./html-to-blocks"

const NBSP = String.fromCharCode(0xa0)

// Synthetic sample with Patreon's body structure (invented text).
const POST_BODY =
  "<p></p>" +
  "<p>“This way,” the guide said, walking briskly. </p>" +
  `<p>${NBSP}&nbsp;</p>` +
  "<p>&nbsp;“Ready?” Mira asked.</p>" +
  "<p><strong><em>Warden of Hollow Lanterns (Expert 2)</em></strong></p>" +
  "<p>* * *</p>" +
  "<p>He laughed. “Not <em>quite</em> yet.”</p>"

describe("htmlToBlocks", () => {
  it("drops empty paragraphs and trims nbsp-only whitespace", () => {
    const blocks = htmlToBlocks(POST_BODY)
    expect(blocks.map((b) => b.type)).toEqual(["p", "p", "p", "hr", "p"])
    expect(blocks[0]).toEqual({ type: "p", text: "“This way,” the guide said, walking briskly." })
    expect(blocks[1]).toEqual({ type: "p", text: "“Ready?” Mira asked." })
  })

  it("keeps a strong/em System line bold-italic", () => {
    const blocks = htmlToBlocks(POST_BODY)
    expect(blocks[2]).toEqual({
      type: "p",
      text: "Warden of Hollow Lanterns (Expert 2)",
      runs: [{ text: "Warden of Hollow Lanterns (Expert 2)", marks: ["b", "i"] }],
    })
    expect(blocksToHtml([blocks[2]])).toBe(
      "<p><strong><em>Warden of Hollow Lanterns (Expert 2)</em></strong></p>",
    )
  })

  it("turns * * * and <hr> into scene breaks", () => {
    expect(htmlToBlocks(POST_BODY)[3].type).toBe("hr")
    expect(htmlToBlocks("<p>a</p><hr><p>b</p>").map((b) => b.type)).toEqual(["p", "hr", "p"])
  })

  it("keeps mixed inline formatting with correct spacing", () => {
    const [b] = htmlToBlocks("<p>A <b>bold</b>, <i>italic</i>, <u>under</u> and <strike>gone</strike>  word.</p>")
    expect(b.text).toBe("A bold, italic, under and gone word.")
    expect(blocksToHtml([b])).toBe("<p>A <strong>bold</strong>, <em>italic</em>, <u>under</u> and <s>gone</s> word.</p>")
  })

  it("collapses whitespace across run boundaries", () => {
    const [b] = htmlToBlocks("<p>one <strong> two </strong> three</p>")
    expect(b.text).toBe("one two three")
    expect(blocksToHtml([b])).toBe("<p>one <strong>two </strong>three</p>")
  })

  it("keeps <br> as a line break, dropping leading/trailing/repeated ones", () => {
    const [b] = htmlToBlocks("<p><br>Name: Ash<br><br>Level: 3 <br></p>")
    expect(b.text).toBe("Name: Ash Level: 3")
    expect(b.runs).toEqual([{ text: "Name: Ash" }, { text: "", br: true }, { text: "Level: 3" }])
  })

  it("maps text-align to Block.align (style or align attribute, inherited)", () => {
    const blocks = htmlToBlocks(
      '<p style="text-align: center;">Mid</p>' +
        '<p style="color:red;text-align:right">Right</p>' +
        '<div align="center"><p>Inherited</p></div>' +
        '<p style="text-align:left">Left</p>',
    )
    expect(blocks.map((b) => b.align)).toEqual(["center", "right", "center", undefined])
    expect(blocksToHtml([blocks[0]])).toBe('<p class="align-center">Mid</p>')
  })

  it("maps headings, quotations and list items", () => {
    const blocks = htmlToBlocks(
      "<h1>Big</h1><h5>Small</h5><blockquote><p>Quote</p></blockquote><ul><li>One</li><li><b>Two</b></li></ul>",
    )
    expect(blocks.map((b) => [b.type, b.role])).toEqual([
      ["p", "h1"],
      ["p", "h4"],
      ["p", "blockquote"],
      ["li", undefined],
      ["li", undefined],
    ])
  })

  it("strips scripts, event handlers and links to plain text", () => {
    const blocks = htmlToBlocks(
      '<p onclick="steal()">Hi <a href="javascript:alert(1)" onmouseover="x()">there</a>' +
        '<script>alert("x")</script><img src=x onerror="alert(1)"></p>' +
        '<style>p{color:red}</style><iframe src="https://evil.example"><p>inner</p></iframe>' +
        '<p><span style="background:url(javascript:alert(1))">ok</span> &lt;script&gt;</p>',
    )
    expect(blocks.map((b) => b.text)).toEqual(["Hi there", "ok <script>"])
    const html = blocksToHtml(blocks)
    expect(html).not.toMatch(/<script|onclick|onmouseover|onerror|javascript:|<a |<img|<iframe|style="background/i)
    expect(html).toContain("ok &lt;script&gt;")
  })

  it("survives a quoted > inside an attribute", () => {
    const blocks = htmlToBlocks('<p title="a > b">Text</p>')
    expect(blocks).toEqual([{ type: "p", text: "Text" }])
  })

  it("decodes named and numeric entities", () => {
    expect(decodeEntities("&amp;&lt;&#8217;&#x2014;&hellip;&bogus;")).toBe("&<’—…&bogus;")
  })
})
