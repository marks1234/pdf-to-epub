import * as pdfjsLib from "pdfjs-dist"
import type { TextItem } from "pdfjs-dist/types/src/display/api"
// Vite resolves this to a hashed URL for the pdf.js worker bundle.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import jEpub from "jepub"

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface EpubMetadata {
  title: string
  author: string
  publisher?: string
  description?: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Convert a (merged) PDF into an EPUB.
 *
 * This is a first-pass, text-based conversion: it extracts the text layer of
 * each page with pdf.js and lays it out as one EPUB chapter per page. Scanned
 * PDFs without a text layer will produce empty pages (OCR would be needed).
 *
 * @param pdfBytes Raw PDF bytes (e.g. the output of {@link mergePdfs}).
 * @param meta     EPUB metadata (title, author, ...).
 * @returns The generated EPUB as a Blob, ready to download.
 */
export async function pdfToEpub(
  pdfBytes: Uint8Array,
  meta: EpubMetadata,
): Promise<Blob> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise

  const epub = new jEpub()
  epub.init({
    i18n: "en",
    title: meta.title,
    author: meta.author,
    publisher: meta.publisher || "pdf-to-epub",
    description: meta.description || "",
  })

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()

    const paragraphs = content.items
      .map((item) => ("str" in item ? (item as TextItem).str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()

    const html = paragraphs
      ? `<p>${escapeHtml(paragraphs)}</p>`
      : "<p><em>(no extractable text on this page)</em></p>"

    epub.add(`Page ${pageNum}`, html)
  }

  return epub.generate("blob") as Promise<Blob>
}
