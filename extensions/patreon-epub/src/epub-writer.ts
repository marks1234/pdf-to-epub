/**
 * Eval-free EPUB 3 writer for the extension.
 *
 * The app builds books with jepub, whose EJS templates compile through
 * `new Function` — forbidden by the MV3 content-script CSP (no 'unsafe-eval').
 * This writer emits the same package the app's jepub + normalizeOcf pipeline
 * produces, from string literals and JSZip only, so it runs in the content
 * script directly:
 *
 * - `mimetype` first and STORED; META-INF/container.xml
 * - OPF 3.0 with dc:identifier/title/creator/language/publisher/description,
 *   `dcterms:modified`, cover-image item + `<meta name="cover">`, a retained
 *   EPUB 2 `<guide>` and `<spine toc="ncx">`
 * - nav.xhtml (toc + landmarks) and an NCX with sequential playOrder
 * - a human-readable TOC page, a cover page, one XHTML5 page per chapter, a
 *   notes page, and the styler's stylesheet
 *
 * Must not import jepub / EJS (directly or through `@/lib/epub-book` values).
 */
import JSZip from "jszip"

import type { Chapter } from "@/lib/epub-book"
import {
  buildNavDocument,
  escapeXml,
  NAV_PATH,
  STYLESHEET_LINK,
  STYLESHEET_PATH,
  utcSeconds,
  type NavEntry,
} from "@/lib/epub-normalize"
import { blocksToHtml, sanitize } from "@/lib/reconstruct"
import type { Styler } from "@/lib/styles"

export interface WriterMeta {
  title: string
  author: string
  identifier: string
  publisher?: string
  description?: string
  /** BCP-47 tag; default "en". */
  language?: string
  /** Text of the closing notes page; omitted page when absent. */
  notes?: string
  /** JPEG or PNG bytes. Anything else throws. */
  cover?: ArrayBuffer | Uint8Array
  /** Overrides "now" for dcterms:modified (tests). */
  modified?: Date
}

const OEBPS = "OEBPS/"
const OPF_PATH = `${OEBPS}content.opf`
const NCX_HREF = "toc.ncx"
const TOC_HREF = "table-of-contents.xhtml"
const COVER_PAGE_HREF = "front-cover.xhtml"
const NOTES_HREF = "notes.xhtml"
const NAV_HREF = NAV_PATH.slice(OEBPS.length)
const CSS_HREF = STYLESHEET_PATH.slice(OEBPS.length)

/** Escape text for XML, dropping characters XML 1.0 forbids. */
export function xmlText(value: string): string {
  return escapeXml(sanitize(value))
}

export function chapterHref(index: number): string {
  return `page-${index}.xhtml`
}

function coverFormat(bytes: Uint8Array): { ext: string; mediaType: string } {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mediaType: "image/jpeg" }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png", mediaType: "image/png" }
  }
  throw new Error("The cover image format isn't supported. Use a JPEG or PNG.")
}

/** An XHTML5 content document with the stylesheet linked. `body` must be well-formed, escaped markup. */
export function xhtmlPage(title: string, body: string, language: string, bodyAttrs = ""): string {
  const lang = escapeXml(language)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
\t<meta charset="utf-8" />
\t<title>${xmlText(title)}</title>
\t${STYLESHEET_LINK}
</head>
<body${bodyAttrs}>
${body}
</body>
</html>
`
}

/** Build the EPUB. Chapters render through `blocksToHtml` with `styler`. */
export async function writeEpub(chapters: Chapter[], meta: WriterMeta, styler: Styler): Promise<Blob> {
  if (chapters.length === 0) throw new Error("Can't build an EPUB with no chapters.")
  const language = meta.language || "en"
  const lang = escapeXml(language)
  const modified = utcSeconds(meta.modified ?? new Date())
  const coverBytes = meta.cover ? new Uint8Array(meta.cover) : undefined
  const cover = coverBytes ? { ...coverFormat(coverBytes), bytes: coverBytes } : undefined
  const coverImageHref = cover ? `cover-image.${cover.ext}` : undefined

  // Reading order after the cover and the TOC page: chapters, then notes.
  const contents: { id: string; href: string; title: string; xhtml: string }[] = chapters.map((ch, i) => {
    const html =
      ch.blocks.length === 0 ? "<p><em>(no text in this post)</em></p>" : blocksToHtml(ch.blocks, styler)
    return {
      id: `page-${i}`,
      href: chapterHref(i),
      title: ch.title,
      xhtml: xhtmlPage(ch.title, `<h1>${xmlText(ch.title)}</h1>\n${html}`, language),
    }
  })
  if (meta.notes) {
    contents.push({
      id: "notes",
      href: NOTES_HREF,
      title: "Notes",
      xhtml: xhtmlPage("Notes", `<h1>Notes</h1>\n<p>${xmlText(meta.notes)}</p>`, language),
    })
  }

  const zip = new JSZip()
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" })
  const add = (path: string, data: string | Uint8Array) => zip.file(path, data, { compression: "DEFLATE" })

  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
\t<rootfiles>
\t\t<rootfile full-path="${OPF_PATH}" media-type="application/oebps-package+xml" />
\t</rootfiles>
</container>
`,
  )

  // ── OPF ──
  const metadata = [
    `<dc:identifier id="book-id">${xmlText(meta.identifier)}</dc:identifier>`,
    `<dc:title>${xmlText(meta.title)}</dc:title>`,
    `<dc:creator id="creator">${xmlText(meta.author)}</dc:creator>`,
    `<dc:language>${lang}</dc:language>`,
    `<dc:publisher>${xmlText(meta.publisher || "pdf-to-epub")}</dc:publisher>`,
    meta.description ? `<dc:description>${xmlText(meta.description)}</dc:description>` : "",
    `<dc:date>${modified}</dc:date>`,
    `<meta property="dcterms:modified">${modified}</meta>`,
    cover ? `<meta name="cover" content="cover-image" />` : "",
  ].filter(Boolean)

  const manifest = [
    `<item id="ncx" href="${NCX_HREF}" media-type="application/x-dtbncx+xml" />`,
    `<item id="nav" href="${NAV_HREF}" media-type="application/xhtml+xml" properties="nav" />`,
    `<item id="rarity-css" href="${CSS_HREF}" media-type="text/css" />`,
    cover
      ? `<item id="cover-image" href="${coverImageHref}" media-type="${cover.mediaType}" properties="cover-image" />`
      : "",
    cover ? `<item id="front-cover" href="${COVER_PAGE_HREF}" media-type="application/xhtml+xml" />` : "",
    `<item id="table-of-contents" href="${TOC_HREF}" media-type="application/xhtml+xml" />`,
    ...contents.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml" />`),
  ].filter(Boolean)

  const spine = [
    cover ? `<itemref idref="front-cover" />` : "",
    `<itemref idref="table-of-contents" />`,
    ...contents.map((c) => `<itemref idref="${c.id}" />`),
  ].filter(Boolean)

  const guide = [
    cover ? `<reference type="cover" title="Cover" href="${COVER_PAGE_HREF}" />` : "",
    `<reference type="toc" title="Table of Contents" href="${TOC_HREF}" />`,
    `<reference type="text" title="Start" href="${contents[0].href}" />`,
  ].filter(Boolean)

  const indent = (lines: string[]) => lines.map((l) => `\t\t${l}`).join("\n")
  add(
    OPF_PATH,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${lang}">
\t<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${indent(metadata)}
\t</metadata>
\t<manifest>
${indent(manifest)}
\t</manifest>
\t<spine toc="ncx">
${indent(spine)}
\t</spine>
\t<guide>
${indent(guide)}
\t</guide>
</package>
`,
  )

  // ── NCX (kept for Kindle / KOReader) ──
  const navPoints = contents
    .map(
      (c, i) => `\t\t<navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
\t\t\t<navLabel><text>${xmlText(c.title)}</text></navLabel>
\t\t\t<content src="${c.href}" />
\t\t</navPoint>`,
    )
    .join("\n")
  add(
    `${OEBPS}${NCX_HREF}`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
\t<head>
\t\t<meta name="dtb:uid" content="${xmlText(meta.identifier)}" />
\t\t<meta name="dtb:depth" content="1" />
\t\t<meta name="dtb:totalPageCount" content="0" />
\t\t<meta name="dtb:maxPageNumber" content="0" />
\t</head>
\t<docTitle><text>${xmlText(meta.title)}</text></docTitle>
\t<docAuthor><text>${xmlText(meta.author)}</text></docAuthor>
\t<navMap>
${navPoints}
\t</navMap>
</ncx>
`,
  )

  // ── EPUB 3 nav (srcs are zip-root relative, as buildNavDocument expects) ──
  const navEntries: NavEntry[] = contents.map((c) => ({ title: xmlText(c.title), src: `${OEBPS}${c.href}` }))
  add(
    NAV_PATH,
    buildNavDocument(navEntries, {
      language,
      coverSrc: cover ? `${OEBPS}${COVER_PAGE_HREF}` : undefined,
      tocSrc: `${OEBPS}${TOC_HREF}`,
      bodymatterSrc: `${OEBPS}${contents[0].href}`,
    }),
  )

  // ── Human-readable TOC page (Kindle's "Go to → Table of Contents") ──
  const tocItems = contents.map((c) => `\t<li><a href="${c.href}">${xmlText(c.title)}</a></li>`).join("\n")
  add(
    `${OEBPS}${TOC_HREF}`,
    xhtmlPage("Table of Contents", `<h1>Table of Contents</h1>\n<ol class="toc">\n${tocItems}\n</ol>`, language),
  )

  if (cover && coverImageHref) {
    add(`${OEBPS}${coverImageHref}`, cover.bytes)
    add(
      `${OEBPS}${COVER_PAGE_HREF}`,
      xhtmlPage(
        meta.title,
        `<section epub:type="cover" style="text-align:center">\n\t<img src="${coverImageHref}" alt="${xmlText(meta.title)}" style="max-width:100%;max-height:100%" />\n</section>`,
        language,
      ),
    )
  }

  for (const c of contents) add(`${OEBPS}${c.href}`, c.xhtml)
  add(STYLESHEET_PATH, styler.css)

  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" })
}
