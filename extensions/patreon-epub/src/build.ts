/**
 * EPUB assembly for the extension: chapters built from post HTML, rendered with
 * the app's `blocksToHtml` + default LitRPG styler, packaged by the eval-free
 * writer (jepub's EJS templates need `new Function`, which the MV3
 * content-script CSP forbids).
 */
import type { Chapter } from "@/lib/epub-book"
import { createStyler, DEFAULT_STYLE_CONFIG } from "@/lib/styles"

import { writeEpub, type WriterMeta } from "./epub-writer"
import { htmlToBlocks } from "./html-to-blocks"
import { cleanChapterTitle } from "./patreon-api"

export interface BookRequest {
  title: string
  author: string
  identifier: string
  description?: string
  notes?: string
  /** JPEG or PNG bytes; dropped (not fatal) if the writer rejects them. */
  cover?: ArrayBuffer
  chapters: Chapter[]
}

/** One fetched post → one chapter. Returns null when the body has no text. */
export function postToChapter(post: { title: string; html: string }, bookTitle?: string): Chapter | null {
  const blocks = htmlToBlocks(post.html)
  if (blocks.every((b) => b.type === "hr")) return null
  return { title: cleanChapterTitle(post.title, bookTitle), blocks }
}

/** Is this a JPEG or PNG? (The only cover formats worth handing to Kindle.) */
export function isJpegOrPng(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes.slice(0, 8))
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  return jpeg || png
}

export async function buildBook(req: BookRequest): Promise<{ blob: Blob; coverDropped: boolean }> {
  const styler = createStyler(DEFAULT_STYLE_CONFIG)
  const meta: WriterMeta = {
    title: req.title,
    author: req.author,
    publisher: "Patreon",
    description: req.description,
    identifier: req.identifier,
    notes: req.notes,
    language: "en",
  }
  const cover = req.cover && isJpegOrPng(req.cover) ? req.cover : undefined
  try {
    return { blob: await writeEpub(req.chapters, { ...meta, cover }, styler), coverDropped: false }
  } catch (e) {
    if (!cover) throw e
    // A cover the writer can't take shouldn't cost the whole book.
    return { blob: await writeEpub(req.chapters, meta, styler), coverDropped: true }
  }
}
