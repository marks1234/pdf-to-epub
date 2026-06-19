import { PDFDocument } from "pdf-lib"

/**
 * Merge several PDF files (in the given order) into a single PDF.
 * Runs entirely in the browser — no upload, no server.
 *
 * @param files PDF files in the order they should appear in the output.
 * @returns The merged PDF as raw bytes.
 */
export async function mergePdfs(files: File[]): Promise<Uint8Array> {
  if (files.length === 0) {
    throw new Error("Add at least one PDF to merge.")
  }

  const merged = await PDFDocument.create()

  for (const file of files) {
    const bytes = await file.arrayBuffer()
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const copied = await merged.copyPages(doc, doc.getPageIndices())
    copied.forEach((page) => merged.addPage(page))
  }

  return merged.save()
}

/** Total page count across a set of PDF files, without merging. */
export async function countPages(files: File[]): Promise<number> {
  let total = 0
  for (const file of files) {
    const bytes = await file.arrayBuffer()
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    total += doc.getPageCount()
  }
  return total
}
