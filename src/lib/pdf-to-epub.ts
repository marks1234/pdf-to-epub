import * as pdfjsLib from "pdfjs-dist"
import type { TextItem } from "pdfjs-dist/types/src/display/api"
// Vite resolves this to a hashed URL for the pdf.js worker bundle.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import jEpub from "jepub"
import JSZip from "jszip"

import { extractNumber } from "@/lib/sequence"

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface EpubMetadata {
  title: string
  author: string
  publisher?: string
  description?: string
}

// Characters illegal in XML 1.0: control chars below 0x20 except tab/newline/CR,
// plus the U+FFFE/U+FFFF non-characters. PDF text extraction occasionally emits
// these, which would otherwise make the chapter XHTML not well-formed.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g

function sanitize(text: string): string {
  return text.replace(INVALID_XML_CHARS, "")
}

function escapeHtml(text: string): string {
  return sanitize(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function isTextItem(item: unknown): item is TextItem {
  return typeof (item as TextItem).str === "string"
}

/**
 * Reconstruct readable paragraphs from pdf.js text items.
 *
 * pdf.js returns text in many sub-word fragments with absolute positions.
 * Naively joining them with spaces breaks words apart ("C h a pt e r") and
 * loses structure. Instead we group fragments into lines by their Y position,
 * insert a space only where there is a real horizontal gap, then join wrapped
 * lines into paragraphs, splitting on larger vertical gaps.
 *
 * @returns Array of paragraph strings (plain text, unescaped).
 */
function reconstructParagraphs(items: TextItem[]): string[] {
  const fragments = items.filter((it) => it.str.trim() !== "" || it.width > 0)
  if (fragments.length === 0) return []

  // Group fragments into lines by baseline Y (PDF Y grows upward).
  interface Line {
    y: number
    height: number
    items: TextItem[]
  }
  const lines: Line[] = []
  for (const it of fragments) {
    const y = it.transform[5]
    const h = it.height || 10
    const line = lines.find((l) => Math.abs(l.y - y) <= Math.max(l.height, h) * 0.5)
    if (line) {
      line.items.push(it)
      line.height = Math.max(line.height, h)
    } else {
      lines.push({ y, height: h, items: [it] })
    }
  }

  // Top-to-bottom.
  lines.sort((a, b) => b.y - a.y)

  const lineTexts = lines
    .map((line) => {
      const sorted = [...line.items].sort(
        (a, b) => a.transform[4] - b.transform[4],
      )
      let text = ""
      let prevEndX: number | null = null
      for (const it of sorted) {
        const x = it.transform[4]
        const w = it.width || 0
        const h = it.height || line.height
        if (prevEndX !== null) {
          const gap = x - prevEndX
          if (gap > h * 0.25 && !text.endsWith(" ")) text += " "
        }
        text += it.str
        prevEndX = x + w
      }
      return { y: line.y, height: line.height, text: text.replace(/\s+/g, " ").trim() }
    })
    .filter((l) => l.text)

  // Join wrapped lines into paragraphs; a large vertical gap starts a new one.
  const paragraphs: string[] = []
  let current = ""
  let prevY: number | null = null
  let prevHeight = 10
  for (const line of lineTexts) {
    if (prevY === null) {
      current = line.text
    } else {
      const gap = prevY - line.y
      if (gap > prevHeight * 1.8) {
        if (current) paragraphs.push(current)
        current = line.text
      } else {
        current = current ? `${current} ${line.text}` : line.text
      }
    }
    prevY = line.y
    prevHeight = line.height
  }
  if (current) paragraphs.push(current)

  return paragraphs
}

/** Derive a chapter title from a file name, e.g. "Chapter 22 (2,509 words).pdf" → "Chapter 22". */
function chapterTitle(filename: string): string {
  const { num, label } = extractNumber(filename)
  if (label && num !== null) return `${label} ${num}`

  const base = filename.replace(/\.[^.]+$/, "")
  const cleaned = base
    .replace(/\s*\([^)]*\)\s*/g, " ") // drop "(2,509 words)"-style notes
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned || base
}

/**
 * Renumber every NCX `playOrder` sequentially (1, 2, 3, …). jepub can emit
 * duplicate values, which EPUB 2 forbids unless they point to the same target
 * (epubcheck RSC-005). Sequential unique values are always valid.
 */
function fixNcxPlayOrder(xml: string): string {
  let n = 0
  return xml.replace(/playOrder="\d+"/g, () => `playOrder="${++n}"`)
}

/**
 * Rebuild an EPUB zip so the `mimetype` entry is first and STORED (uncompressed),
 * as required by the OCF spec, and fix the NCX play order. jepub/JSZip otherwise
 * trip epubcheck (PKG-007 / RSC-005) and stricter readers like Send-to-Kindle.
 */
async function normalizeOcf(epubBlob: Blob): Promise<Blob> {
  const src = await JSZip.loadAsync(epubBlob)
  const out = new JSZip()

  // mimetype must be the very first entry and uncompressed.
  out.file("mimetype", "application/epub+zip", { compression: "STORE" })

  for (const entry of Object.values(src.files)) {
    if (entry.dir || entry.name === "mimetype") continue
    if (entry.name.toLowerCase().endsWith(".ncx")) {
      const xml = await entry.async("string")
      out.file(entry.name, fixNcxPlayOrder(xml), { compression: "DEFLATE" })
    } else {
      const data = await entry.async("uint8array")
      out.file(entry.name, data, { compression: "DEFLATE" })
    }
  }

  return out.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
  })
}

/** Extract the text of one PDF as paragraph HTML across all its pages. */
async function pdfFileToHtml(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise

  const paragraphs: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const items = content.items.filter(isTextItem)
    paragraphs.push(...reconstructParagraphs(items))
  }

  if (paragraphs.length === 0) {
    return "<p><em>(no extractable text — this PDF may be scanned images)</em></p>"
  }
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")
}

/**
 * Convert a list of PDF files into a single EPUB — one chapter per file, titled
 * from the file name (e.g. "Chapter 22"). Text is reconstructed from glyph
 * geometry so words and paragraphs survive.
 *
 * Scanned PDFs without a text layer produce empty chapters (OCR would be needed).
 *
 * @param files Ordered PDF files (the queue order).
 * @param meta  EPUB metadata (title, author, ...).
 * @returns A spec-compliant EPUB Blob, ready to download.
 */
export async function pdfToEpub(
  files: File[],
  meta: EpubMetadata,
): Promise<Blob> {
  if (files.length === 0) throw new Error("Add at least one PDF to convert.")

  const epub = new jEpub()
  epub.init({
    i18n: "en",
    title: meta.title,
    author: meta.author,
    publisher: meta.publisher || "pdf-to-epub",
    description: meta.description || "",
  })

  for (const file of files) {
    const html = await pdfFileToHtml(file)
    epub.add(chapterTitle(file.name), html)
  }

  // jepub references a notes page in its manifest; create it so the EPUB
  // doesn't point at a missing file (epubcheck RSC-001).
  epub.notes(`Generated by pdf-to-epub from ${files.length} file(s).`)

  const raw = (await epub.generate("blob")) as Blob
  return normalizeOcf(raw)
}
