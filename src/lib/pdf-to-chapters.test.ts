import { describe, it, expect, beforeEach, vi } from "vitest"

import { pdfToChapters } from "./pdf-to-epub"

/**
 * Batch-extraction contract tests. pdf.js can't parse real PDFs here (no worker,
 * no DOM), so `pdfjs-dist` is mocked with a document whose pages are declared by
 * the "PDF" file's own contents. Everything below the mock — normalization,
 * reconstruction, header stripping, page stitching, de-hyphenation, error
 * containment, progress and abort — is the real code path.
 */

const state = vi.hoisted(() => ({
  destroyed: [] as string[],
  cleaned: [] as string[],
  /** Called with (fileName, pageNum) before each page is read. */
  onPage: null as null | ((name: string, pageNum: number) => void),
}))

/**
 * A fake PDF. `getDocument` only ever sees bytes, so the whole document — its
 * name included — is encoded into the file's contents.
 */
interface FakePdf {
  name: string
  /** `pages[i]` is the list of text lines on page i+1. */
  pages: string[][]
  /** When set, opening the document rejects with this message. */
  fail?: string
}

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }))

vi.mock("pdfjs-dist", () => {
  const LINE_HEIGHT = 10
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: ({ data }: { data: Uint8Array }) => {
      const spec = JSON.parse(new TextDecoder().decode(data)) as FakePdf
      const name = spec.name
      if (spec.fail) {
        return { promise: Promise.reject(new Error(spec.fail)) }
      }
      const pdf = {
        numPages: spec.pages.length,
        getPage: async (pageNum: number) => {
          state.onPage?.(name, pageNum)
          return {
            getTextContent: async () => ({
              // Lines are spaced well past the new-paragraph threshold, so each
              // declared line becomes its own block.
              items: spec.pages[pageNum - 1].map((str, i) => ({
                str,
                width: str.length * 5,
                height: LINE_HEIGHT,
                transform: [1, 0, 0, 1, 50, 1000 - i * LINE_HEIGHT * 3],
              })),
            }),
            cleanup: () => state.cleaned.push(`${name}:${pageNum}`),
          }
        },
        destroy: async () => {
          state.destroyed.push(name)
        },
      }
      return { promise: Promise.resolve(pdf) }
    },
  }
})

function fakeFile(spec: FakePdf): File {
  return new File([JSON.stringify(spec)], spec.name, { type: "application/pdf" })
}

/** A readable PDF with the given pages of text lines. */
function pdf(name: string, pages: string[][]): File {
  return fakeFile({ name, pages })
}

/** A PDF that fails to open at all (corrupt, encrypted, not a PDF). */
function brokenPdf(name: string, error: string): File {
  return fakeFile({ name, pages: [], fail: error })
}

beforeEach(() => {
  state.destroyed = []
  state.cleaned = []
  state.onPage = null
})

describe("pdfToChapters", () => {
  it("returns one chapter per file, in queue order, with the total page count", async () => {
    const result = await pdfToChapters([
      pdf("Chapter 1 (1,204 words).pdf", [["Hello."], ["World."]]),
      pdf("Chapter 2.pdf", [["Second."]]),
    ])

    expect(result.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2"])
    expect(result.pageCount).toBe(3)
    expect(result.failures).toEqual([])
    expect(result.emptyChapters).toEqual([])
    expect(result.chapters[0].blocks).toEqual([
      { type: "p", text: "Hello." },
      { type: "p", text: "World." },
    ])
  })

  it("contains a failing file instead of killing the batch", async () => {
    const result = await pdfToChapters([
      pdf("Chapter 1.pdf", [["Fine."]]),
      brokenPdf("Chapter 2.pdf", "Invalid PDF structure"),
      pdf("Chapter 3.pdf", [["Also fine."]]),
    ])

    expect(result.chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 3"])
    expect(result.failures).toEqual([
      { name: "Chapter 2.pdf", error: "Invalid PDF structure" },
    ])
    expect(result.pageCount).toBe(2)
  })

  it("reports chapters that produced no text without dropping them", async () => {
    const result = await pdfToChapters([
      pdf("Chapter 1.pdf", [[]]),
      pdf("Chapter 2.pdf", [["Text."]]),
    ])
    expect(result.emptyChapters).toEqual(["Chapter 1"])
    expect(result.chapters).toHaveLength(2)
    expect(result.chapters[0].blocks).toEqual([])
  })

  it("reports progress once at the start and after every file", async () => {
    const calls: [number, number, string][] = []
    await pdfToChapters(
      [
        pdf("Chapter 1.pdf", [["a"]]),
        brokenPdf("Chapter 2.pdf", "nope"),
        pdf("Chapter 3.pdf", [["c"]]),
      ],
      { onProgress: (done, total, name) => calls.push([done, total, name]) },
    )
    expect(calls).toEqual([
      [0, 3, "Chapter 1.pdf"],
      [1, 3, "Chapter 1.pdf"],
      [2, 3, "Chapter 2.pdf"],
      [3, 3, "Chapter 3.pdf"],
    ])
  })

  it("releases every page and destroys every document", async () => {
    await pdfToChapters([
      pdf("Chapter 1.pdf", [["a"], ["b"]]),
      pdf("Chapter 2.pdf", [["c"]]),
    ])
    expect(state.cleaned).toEqual([
      "Chapter 1.pdf:1",
      "Chapter 1.pdf:2",
      "Chapter 2.pdf:1",
    ])
    expect(state.destroyed).toEqual(["Chapter 1.pdf", "Chapter 2.pdf"])
  })

  it("rejects with an AbortError when the signal fires between files", async () => {
    const controller = new AbortController()
    const promise = pdfToChapters(
      [pdf("Chapter 1.pdf", [["a"]]), pdf("Chapter 2.pdf", [["b"]])],
      {
        signal: controller.signal,
        onProgress: (done) => {
          if (done === 1) controller.abort()
        },
      },
    )
    await expect(promise).rejects.toMatchObject({ name: "AbortError" })
    expect(state.destroyed).toEqual(["Chapter 1.pdf"])
  })

  it("rejects with an AbortError when the signal fires between pages", async () => {
    const controller = new AbortController()
    state.onPage = (_name, pageNum) => {
      if (pageNum === 2) controller.abort()
    }
    const promise = pdfToChapters([pdf("Chapter 1.pdf", [["a"], ["b"], ["c"]])], {
      signal: controller.signal,
    })
    await expect(promise).rejects.toMatchObject({ name: "AbortError" })
    // Aborting mid-file must still release the document.
    expect(state.destroyed).toEqual(["Chapter 1.pdf"])
  })

  it("rejects immediately for an already-aborted signal", async () => {
    await expect(
      pdfToChapters([pdf("Chapter 1.pdf", [["a"]])], {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(state.destroyed).toEqual([])
  })

  it("still throws when given no files at all", async () => {
    await expect(pdfToChapters([])).rejects.toThrow(/at least one PDF/)
  })

  it("applies the whole cleanup pipeline across pages and chapters", async () => {
    const result = await pdfToChapters([
      pdf("Chapter 1.pdf", [
        ["Running Head", "The soft­ware felt inter-", "1"],
        ["Running Head", "esting to the ﬁrst operator.", "2"],
        ["Running Head", "* * *", "3"],
      ]),
      // The dictionary evidence for "interesting" lives in another chapter.
      pdf("Chapter 2.pdf", [["An interesting day."]]),
    ])

    expect(result.chapters[0].blocks).toEqual([
      { type: "p", text: "The software felt interesting to the first operator." },
      { type: "hr", text: "* * *" },
    ])
  })

  it("keeps a hyphen the document never corroborates", async () => {
    const result = await pdfToChapters([
      pdf("Chapter 1.pdf", [["a well-"], ["known trick"]]),
    ])
    expect(result.chapters[0].blocks).toEqual([
      { type: "p", text: "a well-known trick" },
    ])
  })
})
