/** Fetched Royal Road chapters → one EPUB, via the Patreon extension's eval-free writer. */
import type { Chapter } from "@/lib/epub-book"
import { sanitizeFilename } from "@/lib/format"
import { createStyler, DEFAULT_STYLE_CONFIG } from "@/lib/styles"

import { writeEpub } from "../../patreon-epub/src/epub-writer"
import { htmlToBlocks } from "../../patreon-epub/src/html-to-blocks"
import type { ChapterBody, FictionMeta } from "./parse"

export interface BookOptions {
  /** Keep author's notes (as quotations around the chapter). Default true. */
  authorNotes?: boolean
}

export function bodyToChapter(title: string, body: ChapterBody, opts: BookOptions = {}): Chapter {
  const notes = opts.authorNotes !== false
  const note = (html: string) => `<p><strong>Author's note</strong></p><blockquote>${html}</blockquote><hr>`
  const html = [
    ...(notes ? body.notesBefore.map(note) : []),
    body.html,
    ...(notes ? body.notesAfter.map((n) => `<hr>${note(n).replace(/<hr>$/, "")}`) : []),
  ].join("\n")
  return { title, blocks: htmlToBlocks(html) }
}

export function bookFilename(title: string, range?: [number, number]): string {
  const suffix = range ? ` (${range[0]}-${range[1]})` : ""
  const stem = sanitizeFilename(title).slice(0, 120 - suffix.length).replace(/[.\s]+$/, "")
  return `${stem || "untitled"}${suffix}.epub`
}

function isJpegOrPng(b: Uint8Array): boolean {
  return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
}

export async function buildBook(meta: FictionMeta, chapters: Chapter[], cover?: Uint8Array): Promise<Blob> {
  return writeEpub(
    chapters,
    {
      title: meta.title,
      author: meta.author,
      identifier: `urn:royalroad:fiction:${meta.id}`,
      publisher: "Royal Road",
      description: meta.description,
      language: "en",
      cover: cover && isJpegOrPng(cover) && cover.byteLength <= 5_000_000 ? cover : undefined,
    },
    createStyler(DEFAULT_STYLE_CONFIG),
  )
}
