import { describe, it, expect, vi } from "vitest"
import JSZip from "jszip"

import {
  NAV_PATH,
  STYLESHEET_PATH,
  addCssToManifest,
  addNavToManifest,
  addSeriesMetadata,
  buildNavDocument,
  escapeXml,
  fixNcxPlayOrder,
  linkCss,
  normalizeOcf,
  parseNcxEntries,
  replaceAnchor,
  toXhtml5,
  upgradeOpfToEpub3,
  utcSeconds,
} from "./epub-normalize"
import { chaptersToEpub } from "./pdf-to-epub"

/**
 * jepub's package.json points `main` at a UMD bundle and `module` at the ESM
 * one. The browser build takes `module`; Node (and therefore vitest) takes
 * `main`, and the UMD wrapper — evaluated as ESM, where `exports`/`define` are
 * absent — assigns itself to `globalThis` instead of exporting anything, so the
 * default import is not a constructor. Point the module at the exact ESM file
 * the app ships so the end-to-end test runs the real library.
 */
vi.mock("jepub", async () => ({
  default: (await import("jepub/dist/jepub.es.js")).default,
}))

/* -------------------------------------------------------------------------- */
/* Fixtures — a faithful copy of what jepub 2.5 writes into the zip.           */
/* Kept verbatim (indentation included) so the anchor-based transforms are     */
/* exercised against the real markup, not a tidied-up version of it.           */
/* -------------------------------------------------------------------------- */

const OPF = `<?xml version="1.0" encoding="UTF-8" ?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="PrimaryID">

	<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
		<dc:title>Test Book</dc:title>
		<dc:language>en</dc:language>
		<dc:identifier id="PrimaryID" opf:scheme="uuid">abc-123</dc:identifier>
        <dc:date opf:event="publication">2026-09-01T12:34:56.789Z</dc:date>
		<dc:description>A book</dc:description>
		<dc:creator opf:role="aut">A. Writer</dc:creator>
		<dc:publisher>pdf-to-epub</dc:publisher>
		<meta name="cover" content="cover-image" />
	</metadata>

	<manifest>
		<item id="front-cover" href="OEBPS/front-cover.html" media-type="application/xhtml+xml" />
		<item id="title-page" href="OEBPS/title-page.html" media-type="application/xhtml+xml" />
		<item id="notes" href="OEBPS/notes.html" media-type="application/xhtml+xml" />
		<item id="table-of-contents" href="OEBPS/table-of-contents.html" media-type="application/xhtml+xml" />
		<item id="page-0" href="OEBPS/page-0.html" media-type="application/xhtml+xml" />
		<item id="page-1" href="OEBPS/page-1.html" media-type="application/xhtml+xml" />
		<item id="cover-image" href="OEBPS/cover-image.jpg" media-type="image/jpeg" />
		<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
	</manifest>

	<spine toc="ncx">
		<itemref idref="front-cover" linear="no" />
		<itemref idref="title-page" linear="yes" />
		<itemref idref="table-of-contents" linear="yes" />
		<itemref idref="page-0" linear="yes" />
		<itemref idref="page-1" linear="yes" />
		<itemref idref="notes" linear="yes" />
	</spine>

	<guide>
		<reference type="cover" title="Cover" href="OEBPS/front-cover.html" />
		<reference type="toc" title="Table of Contents" href="OEBPS/table-of-contents.html" />
	</guide>

</package>
`

// Note the duplicate playOrder="2": jepub numbers the notes page as if it were
// the second entry, which is the RSC-005 bug `fixNcxPlayOrder` exists for.
const NCX = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">

<ncx version="2005-1" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/ncx/">
	<head>
		<meta name="dtb:uid" content="abc-123" />
	</head>
	<docTitle><text>Test Book</text></docTitle>
	<navMap>
		<navPoint id="title-page" playOrder="1">
			<navLabel>
				<text>Information</text>
			</navLabel>
			<content src="OEBPS/title-page.html" />
		</navPoint>
		<navPoint id="table-of-contents" playOrder="2">
			<navLabel>
				<text>Table of Contents</text>
			</navLabel>
			<content src="OEBPS/table-of-contents.html" />
		</navPoint>
            <navPoint id="page-0" playOrder="3">
                <navLabel>
                    <text>Chapter 1</text>
                </navLabel>
                <content src="OEBPS/page-0.html" />
                </navPoint>
            <navPoint id="page-1" playOrder="4">
                <navLabel>
                    <text>Chapter 2 &amp; a half</text>
                </navLabel>
                <content src="OEBPS/page-1.html" />
                </navPoint>
            <navPoint id="notes-page" playOrder="2">
                <navLabel>
                    <text>Notes</text>
                </navLabel>
                <content src="OEBPS/notes.html" />
            </navPoint>
	</navMap>
</ncx>
`

const page = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">

<head>
	<title>${title}</title>
	<meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />
</head>

<body>
	<div class="chapter type-1">${body}</div>
</body>

</html>
`

/**
 * Wrap zip bytes in a Blob. JSZip types its output as `Uint8Array<ArrayBufferLike>`,
 * which isn't assignable to `BlobPart`, so copy out a plain ArrayBuffer.
 */
function blobOf(bytes: Uint8Array): Blob {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return new Blob([buffer], { type: "application/epub+zip" })
}

/** Build the zip jepub would have produced, as a Blob. */
async function jepubLikeEpub(): Promise<Blob> {
  const zip = new JSZip()
  // Deliberately NOT first, and deflated — the PKG-007 bug we correct.
  zip.file("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8" ?>\n<container />')
  zip.file("book.opf", OPF)
  zip.file("toc.ncx", NCX)
  zip.file("mimetype", "application/epub+zip")
  zip.file("OEBPS/title-page.html", page("Information", "<h1>Test Book</h1>"))
  zip.file("OEBPS/table-of-contents.html", page("Table of Contents", "<ul></ul>"))
  zip.file("OEBPS/front-cover.html", page("Cover", '<img src="../OEBPS/cover-image.jpg" alt="" />'))
  zip.file("OEBPS/page-0.html", page("Chapter 1", "<p>one</p>"))
  zip.file("OEBPS/page-1.html", page("Chapter 2", "<p>two</p>"))
  zip.file("OEBPS/notes.html", page("Notes", "<p>notes</p>"))
  zip.file("OEBPS/cover-image.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))
  return blobOf(await zip.generateAsync({ type: "uint8array" }))
}

/**
 * Read the first local file header of a zip: its name and whether the entry is
 * STORED. The OCF spec requires `mimetype` to be the first entry, uncompressed.
 */
function firstZipEntry(bytes: Uint8Array): { name: string; stored: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]) // "PK\x03\x04"
  const method = view.getUint16(8, true)
  const nameLength = view.getUint16(26, true)
  const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength))
  return { name, stored: method === 0 }
}

/* -------------------------------------------------------------------------- */

describe("fixNcxPlayOrder", () => {
  it("renumbers duplicate playOrder values sequentially (epubcheck RSC-005)", () => {
    const orders = [...fixNcxPlayOrder(NCX).matchAll(/playOrder="(\d+)"/g)].map((m) => m[1])
    expect(orders).toEqual(["1", "2", "3", "4", "5"])
  })

  it("leaves an NCX without playOrder untouched", () => {
    expect(fixNcxPlayOrder("<navMap />")).toBe("<navMap />")
  })
})

describe("parseNcxEntries", () => {
  it("reads every navPoint's title and href in spine order", () => {
    expect(parseNcxEntries(NCX)).toEqual([
      { title: "Information", src: "OEBPS/title-page.html" },
      { title: "Table of Contents", src: "OEBPS/table-of-contents.html" },
      { title: "Chapter 1", src: "OEBPS/page-0.html" },
      { title: "Chapter 2 &amp; a half", src: "OEBPS/page-1.html" },
      { title: "Notes", src: "OEBPS/notes.html" },
    ])
  })

  it("throws when the NCX has no navMap", () => {
    expect(() => parseNcxEntries("<ncx />")).toThrow(/no <navMap>/)
  })

  it("throws when the navMap is empty", () => {
    expect(() => parseNcxEntries("<navMap>\n</navMap>")).toThrow(/no navPoints/)
  })
})

describe("stylesheet injection", () => {
  it("declares the stylesheet in the manifest", () => {
    const opf = addCssToManifest(OPF)
    expect(opf).toContain(`href="${STYLESHEET_PATH}" media-type="text/css"`)
    expect(opf.indexOf("rarity-css")).toBeLessThan(opf.indexOf("</manifest>"))
  })

  it("links the stylesheet from a page head", () => {
    const html = linkCss(page("Chapter 1", "<p>one</p>"))
    expect(html).toContain('<link rel="stylesheet" type="text/css" href="style.css" />')
    expect(html.indexOf("stylesheet")).toBeLessThan(html.indexOf("</head>"))
  })

  it("throws instead of silently no-op'ing when the manifest anchor is gone", () => {
    expect(() => addCssToManifest("<package />")).toThrow(/could not find "<\/manifest>"/)
  })

  it("throws instead of silently no-op'ing when the head anchor is gone", () => {
    expect(() => linkCss("<html><body /></html>")).toThrow(/could not find "<\/head>"/)
  })

  it("names the jepub format as the likely cause", () => {
    expect(() => addNavToManifest("<package />")).toThrow(/jepub output format probably changed/)
  })
})

describe("replaceAnchor", () => {
  it("replaces only the first occurrence", () => {
    expect(replaceAnchor("a-b-a", "a", "X", "test")).toBe("X-b-a")
  })
})

describe("escapeXml", () => {
  it("escapes everything that could break an attribute or text node", () => {
    expect(escapeXml(`Tom & "Jerry" <b>'s`)).toBe(
      "Tom &amp; &quot;Jerry&quot; &lt;b&gt;&#39;s",
    )
  })
})

describe("utcSeconds", () => {
  it("drops milliseconds — EPUB 3 only accepts second precision", () => {
    expect(utcSeconds(new Date("2026-09-01T12:34:56.789Z"))).toBe("2026-09-01T12:34:56Z")
  })
})

describe("toXhtml5", () => {
  const out = toXhtml5(page("Chapter 1", "<p>one</p>"), "fr-CA")

  it("replaces the XHTML 1.1 doctype (epubcheck HTM-004)", () => {
    expect(out).toContain("<!DOCTYPE html>")
    expect(out).not.toContain("XHTML 1.1")
  })

  it("replaces the non-conforming http-equiv meta with a charset meta", () => {
    expect(out).not.toContain("http-equiv")
    expect(out).toContain('<meta charset="utf-8" />')
  })

  it("sets both lang and xml:lang, keeping the XHTML namespace", () => {
    expect(out).toContain(
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="fr-CA" lang="fr-CA">',
    )
  })

  it("keeps the XML declaration first", () => {
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8" ?>')).toBe(true)
  })

  it("adds a doctype when there is none", () => {
    expect(toXhtml5("<html><head></head></html>", "en")).toContain("<!DOCTYPE html>\n<html")
  })
})

describe("buildNavDocument", () => {
  const nav = buildNavDocument(parseNcxEntries(NCX), {
    language: "en",
    coverSrc: "OEBPS/front-cover.html",
    tocSrc: "OEBPS/table-of-contents.html",
    bodymatterSrc: "OEBPS/page-0.html",
  })

  it("is an XHTML5 document in the epub namespace", () => {
    expect(nav).toContain("<!DOCTYPE html>")
    expect(nav).toContain('xmlns:epub="http://www.idpf.org/2007/ops"')
  })

  it("emits a flat toc nav with one entry per content document", () => {
    expect(nav).toContain('<nav epub:type="toc" id="toc">')
    expect(nav).toContain('<li><a href="page-0.html">Chapter 1</a></li>')
    expect(nav).toContain('<li><a href="page-1.html">Chapter 2 &amp; a half</a></li>')
    // hrefs are relative to the nav doc's own folder, not the package root.
    expect(nav).not.toContain('href="OEBPS/')
    expect(nav.match(/<li>/g)).toHaveLength(5 + 3) // toc entries + landmarks
  })

  it("emits hidden landmarks for cover, toc and bodymatter", () => {
    expect(nav).toContain('<nav epub:type="landmarks" id="landmarks" hidden="">')
    expect(nav).toContain('<a epub:type="cover" href="front-cover.html">')
    expect(nav).toContain('<a epub:type="toc" href="table-of-contents.html">')
    expect(nav).toContain('<a epub:type="bodymatter" href="page-0.html">')
  })

  it("omits the landmarks nav entirely when there is nothing to point at", () => {
    const bare = buildNavDocument([{ title: "One", src: "OEBPS/page-0.html" }], {
      language: "en",
    })
    expect(bare).not.toContain("landmarks")
  })

  it("links the stylesheet", () => {
    expect(nav).toContain('href="style.css"')
  })
})

describe("upgradeOpfToEpub3", () => {
  const opf = upgradeOpfToEpub3(OPF, {
    css: "",
    language: "en-GB",
    modified: new Date("2026-09-01T12:34:56.789Z"),
    startSrc: "OEBPS/page-0.html",
  })

  it("bumps the package version", () => {
    expect(opf).toContain('<package version="3.0"')
  })

  it("adds dcterms:modified with second precision", () => {
    expect(opf).toContain(
      '<meta property="dcterms:modified">2026-09-01T12:34:56Z</meta>',
    )
  })

  it("drops the opf: attributes EPUB 3 forbids on dc: elements", () => {
    expect(opf).not.toContain("opf:scheme")
    expect(opf).not.toContain("opf:role")
    expect(opf).not.toContain("opf:event")
    expect(opf).toContain('<dc:identifier id="PrimaryID">abc-123</dc:identifier>')
    expect(opf).toContain("<dc:creator>A. Writer</dc:creator>")
  })

  it("sets dc:language and normalizes dc:date", () => {
    expect(opf).toContain("<dc:language>en-GB</dc:language>")
    expect(opf).toContain("<dc:date>2026-09-01T12:34:56Z</dc:date>")
  })

  it("keeps the EPUB 2 machinery: NCX spine and guide", () => {
    expect(opf).toContain('<spine toc="ncx">')
    expect(opf).toContain('<item id="ncx" href="toc.ncx"')
    expect(opf).toContain('<reference type="toc"')
    expect(opf).toContain('<reference type="cover"')
  })

  it("adds the guide start-reading reference Kindle honors", () => {
    expect(opf).toContain('<reference type="text" title="Start" href="OEBPS/page-0.html" />')
  })

  it("flags the cover image with the EPUB 3 property, keeping the OPF 2 meta", () => {
    expect(opf).toContain(
      '<item id="cover-image" href="OEBPS/cover-image.jpg" media-type="image/jpeg" properties="cover-image" />',
    )
    expect(opf).toContain('<meta name="cover" content="cover-image" />')
  })

  it("throws when the package version anchor is gone", () => {
    expect(() => upgradeOpfToEpub3('<package version="3.0" />', { css: "" })).toThrow(
      /could not find .*to set the EPUB 3 version/,
    )
  })

  it("throws when dc:language is missing", () => {
    expect(() =>
      upgradeOpfToEpub3('<package version="2.0"><metadata></metadata></package>', { css: "" }),
    ).toThrow(/no <dc:language>/)
  })

  it("does not add series metadata unless asked", () => {
    expect(opf).not.toContain("calibre:series")
    expect(opf).not.toContain("belongs-to-collection")
  })
})

describe("addSeriesMetadata", () => {
  it("writes both the calibre and the EPUB 3 collection dialects", () => {
    const opf = addSeriesMetadata(OPF, "Tales & Legends", 3)
    expect(opf).toContain('<meta name="calibre:series" content="Tales &amp; Legends" />')
    expect(opf).toContain('<meta name="calibre:series_index" content="3" />')
    expect(opf).toContain(
      '<meta property="belongs-to-collection" id="series">Tales &amp; Legends</meta>',
    )
    expect(opf).toContain('<meta refines="#series" property="collection-type">series</meta>')
    expect(opf).toContain('<meta refines="#series" property="group-position">3</meta>')
    expect(opf.indexOf("calibre:series")).toBeLessThan(opf.indexOf("</metadata>"))
  })

  it("omits the position when there is no index", () => {
    const opf = addSeriesMetadata(OPF, "Standalone")
    expect(opf).toContain('<meta name="calibre:series" content="Standalone" />')
    expect(opf).not.toContain("series_index")
    expect(opf).not.toContain("group-position")
  })
})

describe("normalizeOcf", () => {
  it("puts mimetype first and STORED (OCF spec, epubcheck PKG-007)", async () => {
    const out = await normalizeOcf(await jepubLikeEpub(), { css: "p{}" })
    const bytes = new Uint8Array(await out.arrayBuffer())
    expect(firstZipEntry(bytes)).toEqual({ name: "mimetype", stored: true })
  })

  it("produces an EPUB 3 package that keeps the NCX, the guide and every file", async () => {
    const out = await normalizeOcf(await jepubLikeEpub(), {
      css: "p{color:red}",
      language: "en-GB",
      series: "Web Novel",
      seriesIndex: 2,
      modified: new Date("2026-09-01T12:34:56Z"),
    })
    const zip = await JSZip.loadAsync(await out.arrayBuffer())
    const names = Object.keys(zip.files)

    expect(names).toContain(NAV_PATH)
    expect(names).toContain(STYLESHEET_PATH)
    expect(names).toContain("toc.ncx")
    expect(names).toContain("OEBPS/cover-image.jpg")
    expect(await zip.file(STYLESHEET_PATH)!.async("string")).toBe("p{color:red}")

    const opf = await zip.file("book.opf")!.async("string")
    expect(opf).toContain('<package version="3.0"')
    expect(opf).toContain('<meta property="dcterms:modified">2026-09-01T12:34:56Z</meta>')
    expect(opf).toContain("<dc:language>en-GB</dc:language>")
    expect(opf).toContain('<spine toc="ncx">')
    expect(opf).toContain("<guide>")
    expect(opf).toContain('<meta name="calibre:series" content="Web Novel" />')
    expect(opf).toContain(
      `<item id="nav" href="${NAV_PATH}" media-type="application/xhtml+xml" properties="nav" />`,
    )
    expect(opf).toContain(`<item id="rarity-css" href="${STYLESHEET_PATH}"`)

    const ncx = await zip.file("toc.ncx")!.async("string")
    expect([...ncx.matchAll(/playOrder="(\d+)"/g)].map((m) => m[1])).toEqual([
      "1", "2", "3", "4", "5",
    ])

    const nav = await zip.file(NAV_PATH)!.async("string")
    expect(nav).toContain('<nav epub:type="toc"')
    expect(nav).toContain('<li><a href="page-0.html">Chapter 1</a></li>')

    // Every content document is XHTML5, language-tagged and styled.
    for (const name of names.filter((n) => n.endsWith(".html"))) {
      const html = await zip.file(name)!.async("string")
      expect(html, name).toContain("<!DOCTYPE html>")
      expect(html, name).not.toContain("http-equiv")
      expect(html, name).toContain('lang="en-GB"')
      expect(html, name).toContain('href="style.css"')
    }
  })

  it("declares every zip entry in the manifest", async () => {
    const out = await normalizeOcf(await jepubLikeEpub(), { css: "" })
    const zip = await JSZip.loadAsync(await out.arrayBuffer())
    const opf = await zip.file("book.opf")!.async("string")
    const undeclared = Object.keys(zip.files).filter(
      (n) =>
        !zip.files[n].dir &&
        n !== "mimetype" &&
        n !== "book.opf" &&
        !n.startsWith("META-INF/") &&
        !opf.includes(`href="${n}"`),
    )
    expect(undeclared).toEqual([])
  })

  it("throws when the book has no NCX", async () => {
    const zip = new JSZip()
    zip.file("mimetype", "application/epub+zip")
    zip.file("book.opf", OPF)
    const epub = blobOf(await zip.generateAsync({ type: "uint8array" }))
    await expect(normalizeOcf(epub, { css: "" })).rejects.toThrow(/no NCX/)
  })
})

/* -------------------------------------------------------------------------- */
/* End to end, through jepub itself.                                           */
/* -------------------------------------------------------------------------- */

describe("chaptersToEpub", () => {
  it("builds a valid EPUB 3 book from chapters and metadata", async () => {
    const blob = await chaptersToEpub(
      [
        { title: "Chapter 1", blocks: [{ type: "p", text: "Hello & goodbye" }] },
        { title: "Chapter 2", blocks: [] },
      ],
      {
        title: "My Web Novel",
        author: "A. Writer",
        description: "Converted from PDF",
        language: "en",
        series: "My Web Novel",
        seriesIndex: 3,
        identifier: "record-42",
      },
    )

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const opf = await zip.file("book.opf")!.async("string")

    expect(opf).toContain('<package version="3.0"')
    expect(opf).toContain("<dc:title>My Web Novel</dc:title>")
    expect(opf).toContain("<dc:creator>A. Writer</dc:creator>")
    expect(opf).toContain('<dc:identifier id="PrimaryID">record-42</dc:identifier>')
    expect(opf).toContain('<meta name="calibre:series_index" content="3" />')
    expect(opf).toMatch(/<meta property="dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/meta>/)
    expect(opf).toContain('properties="nav"')

    const nav = await zip.file(NAV_PATH)!.async("string")
    expect(nav).toContain(">Chapter 1<")
    expect(nav).toContain(">Chapter 2<")
    expect(nav).toContain('epub:type="bodymatter"')

    const chapter = await zip.file("OEBPS/page-0.html")!.async("string")
    expect(chapter).toContain("<!DOCTYPE html>")
    expect(chapter).toContain("Hello &amp; goodbye")
    expect(chapter).toContain('href="style.css"')

    // Empty chapters still get a body, so the spine never points at a blank page.
    expect(await zip.file("OEBPS/page-1.html")!.async("string")).toContain(
      "no extractable text",
    )

    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(firstZipEntry(bytes)).toEqual({ name: "mimetype", stored: true })
  })

  it("embeds a cover as a real image, page, guide reference and landmark", async () => {
    // A JPEG magic number is all jepub sniffs; 12+ bytes are required.
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(16).fill(0)])], {
      type: "image/jpeg",
    })
    const blob = await chaptersToEpub(
      [{ title: "Chapter 1", blocks: [] }],
      { title: "Book", author: "Author", cover: jpeg },
    )
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toContain("OEBPS/cover-image.jpg")

    const opf = await zip.file("book.opf")!.async("string")
    expect(opf).toContain('<meta name="cover" content="cover-image" />')
    expect(opf).toContain('properties="cover-image"')
    expect(opf).toContain('<reference type="cover"')

    // A real <img> in an XHTML page, not a CSS background — Kindle needs that.
    const coverPage = await zip.file("OEBPS/front-cover.html")!.async("string")
    expect(coverPage).toContain("<img")
    expect(coverPage).toContain("<!DOCTYPE html>")

    expect(await zip.file(NAV_PATH)!.async("string")).toContain('epub:type="cover"')
  })

  it("reports an unusable cover instead of silently dropping it", async () => {
    await expect(
      chaptersToEpub([{ title: "Chapter 1", blocks: [] }], {
        title: "Book",
        author: "Author",
        cover: new Blob([new Uint8Array(32)], { type: "text/plain" }),
      }),
    ).rejects.toThrow(/cover image format isn't supported/)
  })

  it("keeps the identifier stable across re-styles", async () => {
    const build = async () =>
      chaptersToEpub([{ title: "Chapter 1", blocks: [] }], {
        title: "Book",
        author: "Author",
        identifier: "record-42",
      })
    const ids = await Promise.all(
      [await build(), await build()].map(async (blob) => {
        const zip = await JSZip.loadAsync(await blob.arrayBuffer())
        const opf = await zip.file("book.opf")!.async("string")
        return /<dc:identifier[^>]*>([^<]+)</.exec(opf)![1]
      }),
    )
    expect(ids).toEqual(["record-42", "record-42"])
  })
})
