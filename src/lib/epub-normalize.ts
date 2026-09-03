import JSZip from "jszip"

/**
 * Post-processing for the EPUB that jepub generates.
 *
 * jepub emits an EPUB 2 package with several spec violations (see
 * `normalizeOcf`). This module rebuilds the zip and rewrites its XML into an
 * EPUB 3 package that is a strict *superset* of the EPUB 2 one:
 *
 * - EPUB 3 `nav.xhtml` (Kobo eInk needs it, or it lists raw spine filenames)
 * - the NCX is KEPT (Kindle requires it for books over 20 pages; KOReader
 *   still leans on it) and its `playOrder` renumbered
 * - the EPUB 2 `<guide>` is KEPT and extended with a `text` (start-reading)
 *   reference, which Kindle honors
 * - jepub's human-readable `OEBPS/table-of-contents.html` stays in the spine,
 *   which is what powers Kindle's "Go to → Table of Contents" menu
 *
 * Every function here is a pure string → string transform so it can be tested
 * without a browser; only `normalizeOcf` touches the zip.
 *
 * All injection points are anchored on markup jepub is known to emit. If an
 * anchor ever disappears (a jepub upgrade), the transform THROWS rather than
 * silently producing a book that is missing its stylesheet or nav document.
 */

// Where the stylesheet lives in the EPUB. Pages sit in OEBPS/ and link it by
// relative name; the OPF (book.opf, at the zip root) references it with the
// OEBPS/ prefix. jepub ships no stylesheet, so we add and wire up our own.
export const STYLESHEET_PATH = "OEBPS/style.css"
export const STYLESHEET_HREF = "style.css"
export const STYLESHEET_MANIFEST_ITEM = `<item id="rarity-css" href="${STYLESHEET_PATH}" media-type="text/css" />`
export const STYLESHEET_LINK = `<link rel="stylesheet" type="text/css" href="${STYLESHEET_HREF}" />`

// The EPUB 3 navigation document. Lives next to the pages so its links (and the
// stylesheet link) are plain sibling names.
export const NAV_PATH = "OEBPS/nav.xhtml"
export const NAV_MANIFEST_ITEM = `<item id="nav" href="${NAV_PATH}" media-type="application/xhtml+xml" properties="nav" />`

/** Options for the whole normalization pass. */
export interface NormalizeOptions {
  /** Stylesheet source, written to `OEBPS/style.css` and linked from every page. */
  css: string
  /** BCP-47 language tag for `dc:language` and the pages' `lang`/`xml:lang`. */
  language?: string
  /** Series name — emitted as calibre + EPUB 3 collection metadata. */
  series?: string
  /** Position within the series (1-based). */
  seriesIndex?: number
  /** Overrides "now" for `dcterms:modified`; tests pin this. */
  modified?: Date
}

/** One navigation entry: a title and an href as written in the NCX. */
export interface NavEntry {
  title: string
  /** `content src`, relative to the package document at the zip root. */
  src: string
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Replace the first occurrence of `anchor`, throwing when it is missing.
 * A silent no-op here would ship a book without a stylesheet or a nav document,
 * and the failure would only surface on the device.
 */
export function replaceAnchor(
  text: string,
  anchor: string,
  replacement: string,
  what: string,
): string {
  const at = text.indexOf(anchor)
  if (at === -1) {
    throw new Error(
      `EPUB normalization failed: could not find ${JSON.stringify(anchor)} to ${what}. ` +
        `The jepub output format probably changed.`,
    )
  }
  return text.slice(0, at) + replacement + text.slice(at + anchor.length)
}

/** Escape a value for use in XML text or a double-quoted attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** `2026-09-01T12:34:56Z` — the only form EPUB 3 accepts for dcterms:modified. */
export function utcSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z")
}

/* -------------------------------------------------------------------------- */
/* NCX                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Renumber every NCX `playOrder` sequentially (1, 2, 3, …). jepub can emit
 * duplicate values, which EPUB 2 forbids unless they point to the same target
 * (epubcheck RSC-005). Sequential unique values are always valid.
 */
export function fixNcxPlayOrder(xml: string): string {
  let n = 0
  return xml.replace(/playOrder="\d+"/g, () => `playOrder="${++n}"`)
}

/**
 * Read the navMap of an NCX into a flat list of `{ title, src }`. The NCX is
 * the only place jepub keeps the chapter titles after rendering, so the EPUB 3
 * nav document is built from it (chapters are flat — one level, well inside
 * Kindle's two-level limit).
 */
export function parseNcxEntries(ncx: string): NavEntry[] {
  const navMap = /<navMap[^>]*>([\s\S]*)<\/navMap>/.exec(ncx)
  if (!navMap) {
    throw new Error(
      "EPUB normalization failed: the NCX has no <navMap>. The jepub output format probably changed.",
    )
  }
  const point =
    /<navPoint\b[^>]*>\s*<navLabel>\s*<text>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\s+src="([^"]+)"/g
  const entries: NavEntry[] = []
  let m: RegExpExecArray | null
  while ((m = point.exec(navMap[1])) !== null) {
    // Titles are already XML-escaped by jepub's template engine.
    entries.push({ title: m[1].trim(), src: m[2] })
  }
  if (entries.length === 0) {
    throw new Error(
      "EPUB normalization failed: the NCX navMap has no navPoints. The jepub output format probably changed.",
    )
  }
  return entries
}

/* -------------------------------------------------------------------------- */
/* XHTML content documents                                                     */
/* -------------------------------------------------------------------------- */

/** Link the stylesheet from a page's `<head>` so its rules apply. */
export function linkCss(html: string): string {
  return replaceAnchor(html, "</head>", `\t${STYLESHEET_LINK}\n</head>`, "link the stylesheet")
}

/**
 * Make one of jepub's pages serviceable as an EPUB 3 content document.
 *
 * jepub emits XHTML 1.1: an obsolete `<!DOCTYPE html PUBLIC …>` (epubcheck
 * HTM-004 under EPUB 3) and `<meta http-equiv="Content-Type"
 * content="application/xhtml+xml; charset=utf-8">`, whose value HTML5 does not
 * allow (only `text/html; charset=…` is a conforming encoding declaration).
 * Both are swapped for their XHTML5 equivalents. The markup itself is already
 * well-formed XML — jepub round-trips page content through an XML serializer —
 * so nothing else has to be rewritten.
 *
 * `lang` is added next to `xml:lang`: Kindle picks its font stack from the
 * document language.
 */
export function toXhtml5(html: string, language: string): string {
  let out = html

  if (/<!DOCTYPE[^>]*>/i.test(out)) {
    out = out.replace(/<!DOCTYPE[^>]*>/i, "<!DOCTYPE html>")
  } else {
    out = replaceAnchor(out, "<html", "<!DOCTYPE html>\n<html", "add the XHTML5 doctype")
  }

  // HTML5 has no conforming `http-equiv` form for XHTML; `<meta charset>` is
  // what EPUB 3 producers emit.
  out = out.replace(
    /<meta\s+http-equiv=["']Content-Type["'][^>]*>/i,
    '<meta charset="utf-8" />',
  )

  const lang = escapeXml(language)
  out = out.replace(/<html\b([^>]*)>/i, (_all, attrs: string) => {
    const rest = attrs.replace(/\s+(?:xml:lang|lang)="[^"]*"/g, "")
    return `<html${rest} xml:lang="${lang}" lang="${lang}">`
  })

  return out
}

/* -------------------------------------------------------------------------- */
/* Navigation document                                                         */
/* -------------------------------------------------------------------------- */

/** Rewrite an NCX `content src` (relative to the zip root) for the nav doc. */
function hrefFromNav(src: string): string {
  const dir = NAV_PATH.slice(0, NAV_PATH.lastIndexOf("/") + 1) // "OEBPS/"
  return src.startsWith(dir) ? src.slice(dir.length) : `../${src}`
}

export interface NavOptions {
  language: string
  /** Heading shown above the list. */
  title?: string
  /** `OEBPS/front-cover.html`, when the book has a cover. */
  coverSrc?: string
  /** The human-readable TOC page, for the `toc` landmark. */
  tocSrc?: string
  /** First chapter, for the `bodymatter` landmark (Kindle "start reading"). */
  bodymatterSrc?: string
}

/**
 * Build the EPUB 3 navigation document: a `toc` nav (flat — one entry per
 * content document) plus a hidden `landmarks` nav. Kobo's eInk readers fall
 * back to listing raw spine filenames without this.
 */
export function buildNavDocument(entries: NavEntry[], options: NavOptions): string {
  const lang = escapeXml(options.language)
  const heading = escapeXml(options.title || "Table of Contents")

  const items = entries
    .map((e) => `\t\t\t<li><a href="${hrefFromNav(e.src)}">${e.title}</a></li>`)
    .join("\n")

  const landmarks: string[] = []
  if (options.coverSrc) {
    landmarks.push(
      `\t\t\t<li><a epub:type="cover" href="${hrefFromNav(options.coverSrc)}">Cover</a></li>`,
    )
  }
  if (options.tocSrc) {
    landmarks.push(
      `\t\t\t<li><a epub:type="toc" href="${hrefFromNav(options.tocSrc)}">Table of Contents</a></li>`,
    )
  }
  if (options.bodymatterSrc) {
    landmarks.push(
      `\t\t\t<li><a epub:type="bodymatter" href="${hrefFromNav(options.bodymatterSrc)}">Start of Content</a></li>`,
    )
  }

  const landmarksNav = landmarks.length
    ? `\n\t<nav epub:type="landmarks" id="landmarks" hidden="">
\t\t<h2>Guide</h2>
\t\t<ol>
${landmarks.join("\n")}
\t\t</ol>
\t</nav>\n`
    : ""

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">

<head>
\t<meta charset="utf-8" />
\t<title>${heading}</title>
\t${STYLESHEET_LINK}
</head>

<body>
\t<nav epub:type="toc" id="toc">
\t\t<h1>${heading}</h1>
\t\t<ol>
${items}
\t\t</ol>
\t</nav>
${landmarksNav}</body>

</html>
`
}

/* -------------------------------------------------------------------------- */
/* Package document (OPF)                                                      */
/* -------------------------------------------------------------------------- */

/** Register the stylesheet in the OPF manifest (epubcheck requires every file declared). */
export function addCssToManifest(opf: string): string {
  return replaceAnchor(
    opf,
    "</manifest>",
    `\t\t${STYLESHEET_MANIFEST_ITEM}\n\t</manifest>`,
    "declare the stylesheet in the manifest",
  )
}

/** Register the navigation document, with the `nav` property EPUB 3 requires. */
export function addNavToManifest(opf: string): string {
  return replaceAnchor(
    opf,
    "</manifest>",
    `\t\t${NAV_MANIFEST_ITEM}\n\t</manifest>`,
    "declare the navigation document in the manifest",
  )
}

/**
 * Series metadata, in both dialects readers actually use: `calibre:series`
 * (Calibre, Kobo) and EPUB 3 `belongs-to-collection`. Kindle ignores both for
 * sideloaded books — group those by templating the title instead.
 */
export function addSeriesMetadata(opf: string, series: string, index?: number): string {
  const name = escapeXml(series)
  const lines = [`<meta name="calibre:series" content="${name}" />`]
  if (typeof index === "number" && Number.isFinite(index)) {
    lines.push(`<meta name="calibre:series_index" content="${index}" />`)
  }
  lines.push(`<meta property="belongs-to-collection" id="series">${name}</meta>`)
  lines.push(`<meta refines="#series" property="collection-type">series</meta>`)
  if (typeof index === "number" && Number.isFinite(index)) {
    lines.push(`<meta refines="#series" property="group-position">${index}</meta>`)
  }
  return replaceAnchor(
    opf,
    "</metadata>",
    `${lines.map((l) => `\t\t${l}`).join("\n")}\n\t</metadata>`,
    "add series metadata",
  )
}

/**
 * Turn jepub's EPUB 2 package document into an EPUB 3 one without losing
 * anything EPUB 2 readers rely on.
 *
 * - `version="3.0"`, plus the required `<meta property="dcterms:modified">`
 * - drops the `opf:scheme` / `opf:role` / `opf:event` attributes, which EPUB 3
 *   does not allow on `dc:` elements
 * - `dc:language` set to the requested tag (Kindle selects fonts from it)
 * - `dc:date` trimmed to second precision (epubcheck OPF-053)
 * - keeps `<spine toc="ncx">` and the `<guide>`, and adds the guide's `text`
 *   reference so Kindle knows where "start reading" is
 * - flags the cover image with `properties="cover-image"` (the `<meta
 *   name="cover">` jepub already emits is what older Kindles read)
 */
export function upgradeOpfToEpub3(
  opf: string,
  options: NormalizeOptions & { startSrc?: string },
): string {
  const language = options.language || "en"
  let out = opf

  out = replaceAnchor(out, '<package version="2.0"', '<package version="3.0"', "set the EPUB 3 version")

  // EPUB 3 forbids the OPF 2 attributes on Dublin Core elements.
  out = out
    .replace(/\s+opf:scheme="[^"]*"/g, "")
    .replace(/\s+opf:role="[^"]*"/g, "")
    .replace(/\s+opf:event="[^"]*"/g, "")

  if (!/<dc:language>[^<]*<\/dc:language>/.test(out)) {
    throw new Error(
      "EPUB normalization failed: the package document has no <dc:language>. " +
        "The jepub output format probably changed.",
    )
  }
  out = out.replace(
    /<dc:language>[^<]*<\/dc:language>/,
    `<dc:language>${escapeXml(language)}</dc:language>`,
  )

  out = out.replace(/<dc:date>([^<]*)<\/dc:date>/, (all, value: string) => {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? all : `<dc:date>${utcSeconds(parsed)}</dc:date>`
  })

  out = replaceAnchor(
    out,
    "</metadata>",
    `\t\t<meta property="dcterms:modified">${utcSeconds(options.modified ?? new Date())}</meta>\n\t</metadata>`,
    "add dcterms:modified",
  )

  if (options.series) out = addSeriesMetadata(out, options.series, options.seriesIndex)

  out = out.replace(
    /<item id="cover-image"([^>]*?)\s*\/>/,
    (_all, attrs: string) => `<item id="cover-image"${attrs} properties="cover-image" />`,
  )

  // Kindle's start-reading-location. jepub's guide only has cover + toc.
  if (options.startSrc && !/<reference\s+type="text"/.test(out)) {
    out = replaceAnchor(
      out,
      "</guide>",
      `\t\t<reference type="text" title="Start" href="${escapeXml(options.startSrc)}" />\n\t</guide>`,
      "add the start-reading reference",
    )
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* Zip                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Rebuild an EPUB zip so the `mimetype` entry is first and STORED (uncompressed),
 * as required by the OCF spec, and fix the NCX play order. jepub/JSZip otherwise
 * trip epubcheck (PKG-007 / RSC-005) and stricter readers like Send-to-Kindle.
 *
 * Also injects the stylesheet, upgrades the package to EPUB 3 and adds the
 * navigation document (see the module comment).
 */
export async function normalizeOcf(
  epubBlob: Blob,
  options: NormalizeOptions,
): Promise<Blob> {
  // JSZip can only read a Blob where FileReader exists; go through an
  // ArrayBuffer so this works in Node (tests) as well as the browser.
  const src = await JSZip.loadAsync(await epubBlob.arrayBuffer())
  const out = new JSZip()

  // mimetype must be the very first entry and uncompressed.
  out.file("mimetype", "application/epub+zip", { compression: "STORE" })

  const language = options.language || "en"
  const entries = Object.values(src.files).filter(
    (entry) => !entry.dir && entry.name !== "mimetype",
  )

  const ncxEntry = entries.find((e) => e.name.toLowerCase().endsWith(".ncx"))
  if (!ncxEntry) {
    throw new Error(
      "EPUB normalization failed: the generated book has no NCX. The jepub output format probably changed.",
    )
  }
  const ncx = fixNcxPlayOrder(await ncxEntry.async("string"))
  const navEntries = parseNcxEntries(ncx)

  const names = new Set(entries.map((e) => e.name))
  const coverSrc = names.has("OEBPS/front-cover.html") ? "OEBPS/front-cover.html" : undefined
  const tocSrc = navEntries.find((e) => /table-of-contents\.html$/.test(e.src))?.src
  const bodymatterSrc =
    navEntries.find((e) => /page-\d+\.html$/.test(e.src))?.src ?? navEntries[0].src

  for (const entry of entries) {
    const name = entry.name.toLowerCase()
    if (entry === ncxEntry) {
      out.file(entry.name, ncx, { compression: "DEFLATE" })
    } else if (name.endsWith(".opf")) {
      const opf = await entry.async("string")
      out.file(
        entry.name,
        addNavToManifest(
          addCssToManifest(upgradeOpfToEpub3(opf, { ...options, startSrc: bodymatterSrc })),
        ),
        { compression: "DEFLATE" },
      )
    } else if (name.endsWith(".html") || name.endsWith(".xhtml")) {
      const html = await entry.async("string")
      out.file(entry.name, linkCss(toXhtml5(html, language)), { compression: "DEFLATE" })
    } else {
      const data = await entry.async("uint8array")
      out.file(entry.name, data, { compression: "DEFLATE" })
    }
  }

  out.file(STYLESHEET_PATH, options.css, { compression: "DEFLATE" })
  out.file(
    NAV_PATH,
    buildNavDocument(navEntries, { language, coverSrc, tocSrc, bodymatterSrc }),
    { compression: "DEFLATE" },
  )

  return out.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  })
}
