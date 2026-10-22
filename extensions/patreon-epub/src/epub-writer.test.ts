import { describe, it, expect } from "vitest"
import JSZip from "jszip"

import type { Chapter } from "@/lib/epub-book"
import { createStyler, DEFAULT_STYLE_CONFIG } from "@/lib/styles"

import { writeEpub, type WriterMeta } from "./epub-writer"

const styler = createStyler(DEFAULT_STYLE_CONFIG)
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

const CHAPTERS: Chapter[] = [
  {
    title: "Chapter 1 <Start> & Co",
    blocks: [
      { type: "p", text: "System line", runs: [{ text: "System line", marks: ["b", "i"] }], align: "center" },
      { type: "p", text: "He said 1 < 2 & left." },
    ],
  },
  { title: "Chapter 2", blocks: [{ type: "p", text: "Second." }, { type: "hr", text: "* * *" }] },
  { title: "Chapter 3", blocks: [{ type: "p", text: "Third." }] },
]

const META: WriterMeta = {
  title: "Book <One> & Two",
  author: "Writer & Co",
  identifier: "patreon-collection-9",
  description: "A <desc>",
  notes: "Personal copy.",
  modified: new Date("2026-10-22T12:34:56.789Z"),
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** First local file header: name and whether it is STORED (method 0). */
function firstZipEntry(bytes: Uint8Array): { name: string; stored: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  const method = view.getUint16(8, true)
  const nameLength = view.getUint16(26, true)
  const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength))
  return { name, stored: method === 0 }
}

async function open(meta: WriterMeta = META, chapters = CHAPTERS) {
  const bytes = await bytesOf(await writeEpub(chapters, meta, styler))
  const zip = await JSZip.loadAsync(bytes)
  const text = (name: string) => zip.file(name)!.async("string")
  return { bytes, zip, text }
}

/** Manifest hrefs (relative to the OPF in OEBPS/), resolved to zip paths. */
function manifestPaths(opf: string): string[] {
  return [...opf.matchAll(/<item [^>]*href="([^"]+)"/g)].map((m) => `OEBPS/${m[1]}`)
}

describe("writeEpub", () => {
  it("puts mimetype first and STORED, with a container pointing at the OPF", async () => {
    const { bytes, text } = await open()
    expect(firstZipEntry(bytes)).toEqual({ name: "mimetype", stored: true })
    expect(await text("mimetype")).toBe("application/epub+zip")
    expect(await text("META-INF/container.xml")).toContain('full-path="OEBPS/content.opf"')
  })

  it("writes an EPUB 3 package whose manifest items all exist", async () => {
    const { zip, text } = await open()
    const opf = await text("OEBPS/content.opf")
    expect(opf).toContain('version="3.0"')
    expect(opf).toContain('<dc:identifier id="book-id">patreon-collection-9</dc:identifier>')
    expect(opf).toContain("<dc:title>Book &lt;One&gt; &amp; Two</dc:title>")
    expect(opf).toContain("<dc:creator id=\"creator\">Writer &amp; Co</dc:creator>")
    expect(opf).toContain("<dc:language>en</dc:language>")
    expect(opf).toContain("<dc:description>A &lt;desc&gt;</dc:description>")
    expect(opf).toContain('<meta property="dcterms:modified">2026-10-22T12:34:56Z</meta>')
    expect(opf).toContain('<spine toc="ncx">')
    expect(opf).toContain('properties="nav"')
    const paths = manifestPaths(opf)
    expect(paths.length).toBeGreaterThan(5)
    for (const p of paths) expect(zip.file(p), p).not.toBeNull()
    // Every spine itemref names a manifest id.
    const ids = new Set([...opf.matchAll(/<item id="([^"]+)"/g)].map((m) => m[1]))
    for (const m of opf.matchAll(/<itemref idref="([^"]+)"/g)) expect(ids.has(m[1]), m[1]).toBe(true)
  })

  it("lists every chapter in order in the nav document and the NCX", async () => {
    const { text } = await open()
    const nav = await text("OEBPS/nav.xhtml")
    const navHrefs = [...nav.matchAll(/<nav epub:type="toc"[\s\S]*?<\/nav>/g)][0][0]
    expect([...navHrefs.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "page-0.xhtml",
      "page-1.xhtml",
      "page-2.xhtml",
      "notes.xhtml",
    ])
    expect(nav).toContain("Chapter 1 &lt;Start&gt; &amp; Co")
    expect(nav).toContain('epub:type="landmarks"')
    expect(nav).toContain('epub:type="bodymatter" href="page-0.xhtml"')

    const ncx = await text("OEBPS/toc.ncx")
    expect([...ncx.matchAll(/<content src="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "page-0.xhtml",
      "page-1.xhtml",
      "page-2.xhtml",
      "notes.xhtml",
    ])
    expect([...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2", "3", "4"])

    const toc = await text("OEBPS/table-of-contents.xhtml")
    expect(toc).toContain('<a href="page-2.xhtml">Chapter 3</a>')
  })

  it("renders chapters as XHTML5 with rich runs, escaping and the stylesheet", async () => {
    const { text } = await open()
    const page = await text("OEBPS/page-0.xhtml")
    expect(page).toContain("<!DOCTYPE html>")
    expect(page).toContain('xmlns="http://www.w3.org/1999/xhtml"')
    expect(page).toContain('xmlns:epub="http://www.idpf.org/2007/ops"')
    expect(page).toContain('xml:lang="en" lang="en"')
    expect(page).toContain('<meta charset="utf-8" />')
    expect(page).toContain('href="style.css"')
    expect(page).toContain("<h1>Chapter 1 &lt;Start&gt; &amp; Co</h1>")
    expect(page).toContain("<title>Chapter 1 &lt;Start&gt; &amp; Co</title>")
    expect(page).toContain('<p class="align-center"><strong><em>System line</em></strong></p>')
    expect(page).toContain("He said 1 &lt; 2 &amp; left.")
    expect(await text("OEBPS/page-1.xhtml")).toContain('<hr class="scene-break" />')
    expect(await text("OEBPS/style.css")).toContain(".align-center{")
  })

  it("wires up a cover image and page when given one", async () => {
    const { zip, text } = await open({ ...META, cover: JPEG })
    const opf = await text("OEBPS/content.opf")
    expect(opf).toContain(
      '<item id="cover-image" href="cover-image.jpg" media-type="image/jpeg" properties="cover-image" />',
    )
    expect(opf).toContain('<meta name="cover" content="cover-image" />')
    expect(opf).toMatch(/<spine toc="ncx">\s*<itemref idref="front-cover" \/>/)
    expect(Array.from(await zip.file("OEBPS/cover-image.jpg")!.async("uint8array"))).toEqual(Array.from(JPEG))
    expect(await text("OEBPS/front-cover.xhtml")).toContain('<img src="cover-image.jpg"')
    expect(await text("OEBPS/nav.xhtml")).toContain('epub:type="cover" href="front-cover.xhtml"')
  })

  it("has no cover wiring without a cover, and rejects non-JPEG/PNG covers", async () => {
    const { zip, text } = await open()
    const opf = await text("OEBPS/content.opf")
    expect(opf).not.toContain("cover-image")
    expect(zip.file("OEBPS/front-cover.xhtml")).toBeNull()
    await expect(writeEpub(CHAPTERS, { ...META, cover: new TextEncoder().encode("GIF89a") }, styler)).rejects.toThrow(
      /cover/,
    )
  })
})
