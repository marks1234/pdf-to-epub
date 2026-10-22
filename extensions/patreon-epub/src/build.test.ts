import { describe, it, expect, vi } from "vitest"
import JSZip from "jszip"

import { buildBook, isJpegOrPng, postToChapter } from "./build"

describe("postToChapter", () => {
  it("cleans the title and returns null for an empty body", () => {
    expect(postToChapter({ title: "Book - Chapter 1", html: "<p>Hi</p>" }, "Book")?.title).toBe("Chapter 1")
    expect(postToChapter({ title: "x", html: "<p></p><p>&nbsp;</p>" })).toBeNull()
    expect(postToChapter({ title: "x", html: "<hr>" })).toBeNull()
  })
})

describe("isJpegOrPng", () => {
  it("sniffs magic bytes", () => {
    expect(isJpegOrPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer)).toBe(true)
    expect(isJpegOrPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).buffer)).toBe(true)
    expect(isJpegOrPng(new TextEncoder().encode("RIFF....WEBP").buffer)).toBe(false)
  })
})

describe("buildBook", () => {
  it("builds an EPUB that keeps formatting, alignment and stat styling", async () => {
    const chapters = [
      postToChapter(
        {
          title: "Book - Chapter 1",
          html:
            '<p style="text-align:center"><strong><em>Warden of Lanterns (Expert 2)</em></strong></p>' +
            "<p>He said <em>no</em> &amp; left.</p><p>* * *</p>" +
            "<p>Weapon: <em>[Legendary]</em> [Sword]</p><p>Armor: [Rare] [Plate]</p>",
        },
        "Book",
      )!,
    ]
    const { blob, coverDropped } = await buildBook({
      title: "Book",
      author: "Writer",
      identifier: "patreon-collection-9",
      notes: "Personal copy.",
      chapters,
    })
    expect(coverDropped).toBe(false)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const names = Object.keys(zip.files)
    const page = names.find((n) => /page-0\.x?html$/.test(n)) as string
    const xhtml = await zip.file(page)!.async("string")
    expect(xhtml).toContain('<p class="align-center"><strong><em>Warden of Lanterns (Expert 2)</em></strong></p>')
    expect(xhtml).toContain("<p>He said <em>no</em> &amp; left.</p>")
    expect(xhtml).toMatch(/<hr class="scene-break" ?\/>/)
    expect(xhtml).toContain('<em><span class="rarity-legendary">[Legendary]</span></em>')
    const css = await zip.file("OEBPS/style.css")!.async("string")
    expect(css).toContain(".align-center{")
    const opf = await zip.file(names.find((n) => n.endsWith(".opf")) as string)!.async("string")
    expect(opf).toContain("patreon-collection-9")
    expect(opf).toContain("Writer")
  })

  it("a writer error is not retried (writeEpub runs exactly once)", async () => {
    const writer = await import("./epub-writer")
    const spy = vi.spyOn(writer, "writeEpub").mockRejectedValueOnce(new Error("boom"))
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer
    const chapters = [postToChapter({ title: "C1", html: "<p>x</p>" })!]
    await expect(buildBook({ title: "B", author: "A", identifier: "id", chapters, cover })).rejects.toThrow("boom")
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it("drops an oversized or non-JPEG/PNG cover up front", async () => {
    const chapters = [postToChapter({ title: "C1", html: "<p>x</p>" })!]
    const webp = new TextEncoder().encode("RIFF....WEBP").buffer as ArrayBuffer
    expect((await buildBook({ title: "B", author: "A", identifier: "id", chapters, cover: webp })).coverDropped).toBe(true)
  })

  it("drops a cover the builder rejects instead of failing", async () => {
    const chapters = [postToChapter({ title: "C1", html: "<p>x</p>" })!]
    // Valid JPEG magic, garbage after: the book must build either way.
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer
    const { blob } = await buildBook({ title: "B", author: "A", identifier: "id", chapters, cover })
    expect(blob.size).toBeGreaterThan(0)
  })
})
