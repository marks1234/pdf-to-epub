import JSZip from "jszip"
import { describe, expect, it } from "vitest"

import { bodyToChapter, bookFilename, buildBook } from "./book"
import {
  fictionIdFromPath,
  hiddenClasses,
  isFictionOverview,
  parseChapter,
  parseChapterList,
  parseFictionMeta,
} from "./parse"

const FICTION = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Mother &amp; Learning" />
<meta property="books:author" content="nobody103" />
<meta property="og:image" content="https://www.royalroadcdn.com/public/covers-large/21220.jpg?time=1" />
</head><body>
<div class="fic-header"><h1 class="font-white">Mother &amp; Learning</h1>
<h4><span>by</span> <a href="/profile/12345" class="font-white">nobody103</a></h4></div>
<div class="description"><div class="hidden-content"><p>Zorian is a teenage mage.</p><p>Second <b>para</b>.</p></div></div>
<table id="chapters"><tbody>
<tr style="cursor: pointer" data-url="/fiction/21220/mol/chapter/2/two" class="chapter-row"><td><a href="/fiction/21220/mol/chapter/2/two">2. Two</a></td></tr>
</tbody></table>
<script>
window.chapters = [{"id":1,"volumeId":null,"title":"1. Good Morning \\"Brother\\"","slug":"one","date":"2015-01-01","order":0,"visible":1,"url":"/fiction/21220/mol/chapter/1/one"},{"id":3,"title":"Hidden","order":2,"visible":0,"url":"/fiction/21220/mol/chapter/3/x"},{"id":2,"title":"2. Life&#39;s Lessons [x]","order":1,"visible":1,"url":"/fiction/21220/mol/chapter/2/two"}];
window.volumes = [];
</script></body></html>`

const CHAPTER = `<html><head><style>
.cmVjZGY4 { display: none; speak: never; }
.other { color: red }
</style></head><body>
<div class="portlet solid author-note-portlet"><div class="portlet-body author-note"><p>Thanks for reading!</p></div></div>
<div class="chapter-inner chapter-content"><p>Zorian's eyes opened.</p>
<div class="wrap"><p>Nested <em>div</em> text.</p></div>
<p class="cmVjZGY4">This story has been stolen from Royal Road.</p>
<p style="text-align: center">* * *</p><p>After the break.</p>
<table><tbody><tr><td>Strength</td><td>10</td></tr></tbody></table>
</div>
<div class="portlet solid author-note-portlet"><div class="portlet-body author-note"><p>See you <b>next</b> week.</p></div></div>
</body></html>`

describe("paths", () => {
  it("finds fiction ids and overview pages", () => {
    expect(fictionIdFromPath("/fiction/21220/mother-of-learning")).toBe("21220")
    expect(fictionIdFromPath("/fiction/21220/mol/chapter/1/one")).toBe("21220")
    expect(fictionIdFromPath("/fictions/best-rated")).toBeNull()
    expect(isFictionOverview("/fiction/21220/mother-of-learning")).toBe(true)
    expect(isFictionOverview("/fiction/21220")).toBe(true)
    expect(isFictionOverview("/fiction/21220/mol/chapter/1/one")).toBe(false)
  })
})

describe("fiction page", () => {
  it("reads metadata", () => {
    const m = parseFictionMeta(FICTION, "21220")
    expect(m.title).toBe("Mother & Learning")
    expect(m.author).toBe("nobody103")
    expect(m.coverUrl).toContain("covers-large/21220.jpg")
    expect(m.description).toBe("Zorian is a teenage mage.\n\nSecond para.")
  })

  it("lists visible chapters in order from window.chapters", () => {
    const list = parseChapterList(FICTION)
    expect(list.map((c) => c.id)).toEqual(["1", "2"])
    expect(list[0].title).toBe('1. Good Morning "Brother"')
    expect(list[1].title).toBe("2. Life's Lessons [x]")
  })

  it("falls back to the chapter table", () => {
    const list = parseChapterList(FICTION.replace(/<script>[\s\S]*<\/script>/, ""))
    expect(list).toEqual([{ id: "2", title: "2. Two", url: "/fiction/21220/mol/chapter/2/two" }])
  })
})

describe("chapter page", () => {
  it("finds hidden classes", () => {
    expect(hiddenClasses(CHAPTER)).toEqual(["cmVjZGY4"])
  })

  it("extracts the text without the hidden line, plus author notes", () => {
    const b = parseChapter(CHAPTER)
    expect(b.html).toContain("Zorian's eyes opened.")
    expect(b.html).toContain("Nested <em>div</em> text.")
    expect(b.html).toContain("After the break.")
    expect(b.html).not.toContain("stolen")
    expect(b.notesBefore).toEqual(["<p>Thanks for reading!</p>"])
    expect(b.notesAfter).toEqual(["<p>See you <b>next</b> week.</p>"])
  })

  it("turns into blocks, with or without notes", () => {
    const b = parseChapter(CHAPTER)
    const withNotes = bodyToChapter("1. One", b).blocks.map((x) => x.text)
    expect(withNotes[0]).toBe("Author's note")
    expect(withNotes).toContain("Thanks for reading!")
    expect(withNotes).toContain("See you next week.")
    expect(withNotes).toContain("Strength")
    const plain = bodyToChapter("1. One", b, { authorNotes: false }).blocks.map((x) => x.text)
    expect(plain[0]).toBe("Zorian's eyes opened.")
    expect(plain.join(" ")).not.toContain("Thanks")
  })

  it("throws when the page has no chapter text", () => {
    expect(() => parseChapter("<html><body>Just a moment...</body></html>")).toThrow()
  })
})

describe("book", () => {
  it("builds a valid-looking EPUB", async () => {
    const meta = parseFictionMeta(FICTION, "21220")
    const ch = bodyToChapter("1. One", parseChapter(CHAPTER))
    const blob = await buildBook(meta, [ch, { ...ch, title: "2. Two" }])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)[0]).toBe("mimetype")
    const opf = await zip.file("OEBPS/content.opf")!.async("string")
    expect(opf).toContain("<dc:title>Mother &amp; Learning</dc:title>")
    expect(opf).toContain("<dc:publisher>Royal Road</dc:publisher>")
    const page = await zip.file("OEBPS/page-0.xhtml")!.async("string")
    expect(page).toContain("Zorian")
    expect(page).not.toContain("stolen")
  })

  it("names files", () => {
    expect(bookFilename("Mother of Learning")).toBe("Mother of Learning.epub")
    expect(bookFilename("A: B?", [3, 9])).toBe("A B (3-9).epub")
  })
})
