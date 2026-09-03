/**
 * Ambient types for `jepub` (verified against node_modules/jepub/dist/jepub.es.js,
 * v2.5.0).
 *
 * The package does ship an `index.d.ts`, but it references `JSZip` and `Buffer`
 * without importing them (only `skipLibCheck` keeps that quiet) and its
 * `generate()` returns a union of every possible output type, which forces an
 * `as Blob` cast at the call site. This ambient declaration takes precedence
 * over the packaged one: it covers the API we actually use and overloads
 * `generate()` per output type, so no cast is needed.
 */
declare module "jepub" {
  /** Book details passed to `init()`. */
  export interface JEpubInitDetails {
    /**
     * Language code used for jepub's own UI strings ("Cover", "Table of
     * Contents", …) and for `dc:language`. Only jepub's 21 built-in codes are
     * accepted — anything else throws. See `JEPUB_UI_LANGUAGES`.
     */
    i18n?: string
    title?: string
    author?: string
    publisher?: string
    /** Supports inline HTML; also rendered into the title page. */
    description?: string
    tags?: string[]
  }

  /** Output types jepub can generate. */
  export type JEpubGenerateType = "blob" | "arraybuffer" | "uint8array"

  /** Progress callback, forwarded to JSZip's `generateAsync`. */
  export type JEpubUpdateCallback = (metadata: {
    percent: number
    currentFile: string
  }) => void

  export default class jEpub {
    constructor()

    /** Start a book. Throws on an unknown `i18n` code. */
    init(details: JEpubInitDetails): this

    /**
     * Append a chapter. `content` is rendered as an EJS template, then
     * serialized as XML, into `OEBPS/page-<n>.html`. `level` nests the entry in
     * the TOC and may only increase by one at a time.
     */
    add(title: string, content?: string | string[] | null, level?: number): this

    /**
     * Set the cover image. A `Blob` is typed from `blob.type`; an `ArrayBuffer`
     * is sniffed from its magic bytes (more reliable). Throws when the format
     * is not a supported image type.
     */
    cover(data: ArrayBuffer | Blob): this

    /** Add an image referenced from chapter content as `<%= image['name'] %>`. */
    image(data: ArrayBuffer | Blob, name: string): this

    /**
     * Write `OEBPS/notes.html`. The manifest always declares this file, so it
     * must be called or the book references a missing document (epubcheck
     * RSC-001). Throws when `content` is empty.
     */
    notes(content: string): this

    /** Set the publication date. Throws unless given a `Date`. */
    date(date: Date): this

    /**
     * Set `dc:identifier`. A URL is recorded with scheme `URI`, anything else
     * as `uuid`. Without this jepub generates a random UUID per build. Throws
     * when `id` is empty.
     */
    uuid(id: string): this

    /** Strip markup from an HTML string. */
    static html2text(html: string, noBr?: boolean): string

    /** Render the package documents and zip everything up. */
    generate(type?: "blob", onUpdate?: JEpubUpdateCallback): Promise<Blob>
    generate(type: "arraybuffer", onUpdate?: JEpubUpdateCallback): Promise<ArrayBuffer>
    generate(type: "uint8array", onUpdate?: JEpubUpdateCallback): Promise<Uint8Array>
  }
}

/**
 * The ESM bundle, addressed directly. Node resolves the bare `jepub` specifier
 * to the UMD `main`, which exports nothing usable, so tests point the module at
 * this file — the same build the browser bundle uses.
 */
declare module "jepub/dist/jepub.es.js" {
  export { default } from "jepub"
}
