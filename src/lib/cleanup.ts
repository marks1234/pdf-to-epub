/**
 * Text cleanup for PDF-extracted prose.
 *
 * Everything here is pure and dependency-free (no pdf.js, no reconstruct.ts) so
 * it is unit-testable and can be composed into the extraction pipeline at the
 * point where it does the least damage:
 *
 *   glyph text  → normalizeCharacters()          (ligatures, soft hyphens, NBSP)
 *   page lines  → stripRunningHeadersFooters()   (running heads / page numbers)
 *   blocks      → isSceneBreak()                 (`* * *` → semantic <hr>)
 *   whole book  → dehyphenateAll()               (Calibre-style, needs the vocab)
 *
 * The de-hyphenation deliberately runs LAST and over the whole document: it uses
 * the document itself as a dictionary, so it needs every chapter's text first.
 */

// ── 1. Character normalization ───────────────────────────────────────────────

/**
 * Ligature glyphs PDF fonts emit for `fi`, `fl`, … Handled with a targeted map
 * rather than a blanket `String.normalize("NFKC")`, because NFKC also rewrites
 * characters that carry meaning in LitRPG stat sheets: superscripts (²→2),
 * fractions (½→1⁄2), the numero sign, roman numerals (Ⅻ→XII) and — worst for us
 * — full-width and squared characters. Only the f-ligatures and the archaic
 * long-s ligatures are decomposed here; Æ/Œ are real letters and are left alone.
 */
const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬅ": "st",
  "ﬆ": "st",
}

const LIGATURE_RE = /[\uFB00-\uFB06]/g
/** Soft hyphen (U+00AD) plus the zero-width family — never meaningful in prose. */
const INVISIBLE_RE = /[\u00AD\u200B-\u200D\uFEFF]/g
/** Non-breaking / narrow / figure spaces collapse to a plain space. */
const HARD_SPACE_RE = /[\u00A0\u202F\u2007]/g

/**
 * Normalize the raw text of one extracted fragment: expand ligatures, drop soft
 * hyphens and zero-width characters, and turn non-breaking spaces into ordinary
 * ones. Safe to run on every glyph — it never changes character count in a way
 * that matters to the geometry pass (which works on fragment boxes, not glyphs).
 */
export function normalizeCharacters(text: string): string {
  return text
    .replace(LIGATURE_RE, (ch) => LIGATURES[ch] ?? ch)
    .replace(INVISIBLE_RE, "")
    .replace(HARD_SPACE_RE, " ")
}

// ── 2. De-hyphenation (document-as-dictionary, Calibre style) ────────────────

/** A letter, in any script (`\w` would be ASCII-only and would include digits). */
const LETTER = "\\p{L}"
/**
 * A word broken across a line: letters, a hyphen (ASCII or U+2010), the wrap
 * whitespace, then a lowercase continuation. Reconstruction joins wrapped lines
 * with a space, so a hyphenated break survives as `"inter- esting"`.
 *
 * A dash *preceded* by whitespace ("wait - no", "wait — no") never matches, so
 * dashes used as punctuation are untouched.
 */
const HYPHEN_WRAP_RE = new RegExp(
  `(${LETTER}+)[-\\u2010][ \\t]+(\\p{Ll}${LETTER}*)`,
  "gu",
)

const WORD_RE = new RegExp(`${LETTER}+`, "gu")

/** Suffixes stripped when probing for a base form ("bright**ness**" → "bright"). */
const SUFFIXES = ["ness", "tion", "ing", "ize", "ly", "ed", "es", "s"]
/** Prefixes stripped when probing for a base form ("**re**build" → "build"). */
const PREFIXES = ["dis", "re", "un", "in"]

/**
 * Build the document's vocabulary: every alphabetic word, lowercased. This is
 * the "dictionary" the de-hyphenation consults, so it should be built from as
 * much text as possible (ideally the whole book, not one chapter).
 */
export function buildVocabulary(texts: Iterable<string>): Set<string> {
  const vocab = new Set<string>()
  for (const text of texts) {
    const words = text.toLowerCase().match(WORD_RE)
    if (words) for (const w of words) vocab.add(w)
  }
  return vocab
}

/** Candidate base forms of `word` after stripping one common affix. */
function affixBases(word: string): string[] {
  const bases: string[] = []
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length)
      bases.push(stem)
      // "moving" → "mov" → "move"; "hoped" → "hop" → "hope".
      if (suffix === "ing" || suffix === "ed") bases.push(`${stem}e`)
    }
  }
  for (const prefix of PREFIXES) {
    if (word.length > prefix.length + 2 && word.startsWith(prefix)) {
      bases.push(word.slice(prefix.length))
    }
  }
  return bases
}

/**
 * Decide how to rejoin the two halves of a word broken at a line end.
 *
 * The hyphen is dropped only when the evidence says the word is one word: the
 * joined form (or a base form of it) occurs elsewhere in the document. When
 * either half is trivially short, or nothing corroborates the join, the hyphen
 * is kept — a wrongly kept hyphen is a cosmetic blemish, a wrongly removed one
 * silently corrupts a real compound ("well-known" → "wellknown").
 */
export function joinHyphenated(
  left: string,
  right: string,
  vocab: ReadonlySet<string>,
): string {
  if (left.length <= 2 || right.length <= 2) return `${left}-${right}`
  const joined = `${left}${right}`
  const lower = joined.toLowerCase()
  if (vocab.has(lower)) return joined
  for (const base of affixBases(lower)) if (vocab.has(base)) return joined
  return `${left}-${right}`
}

/**
 * Rejoin every line-wrap hyphenation in `text`, using `vocab` as the dictionary.
 * The wrap whitespace is always removed; only the hyphen's fate is decided by
 * the vocabulary.
 */
export function dehyphenate(text: string, vocab: ReadonlySet<string>): string {
  return text.replace(HYPHEN_WRAP_RE, (_match, left: string, right: string) =>
    joinHyphenated(left, right, vocab),
  )
}

/**
 * De-hyphenate a whole document at once: the vocabulary is built from all of
 * `texts` and then applied to each of them. Returns a new array, same order.
 */
export function dehyphenateAll(texts: readonly string[]): string[] {
  const vocab = buildVocabulary(texts)
  return texts.map((t) => dehyphenate(t, vocab))
}

// ── 3. Running header / footer removal ───────────────────────────────────────

/** The minimum shape this module needs from a reconstructed line. */
export interface TextLine {
  text: string
}

/** A bare page number: "17". */
const PAGE_NUMBER_RE = /^\s*\d+\s*$/
/** "3 of 40", "3 / 40", "Page 3 of 40". */
const PAGE_OF_RE = /^\s*(page\s+)?\d+\s*(of|\/)\s*\d+\s*$/i

/** How many lines at each edge of a page can be a running head / foot. */
const EDGE_LINES = 2
/** A running head must appear on more than this share of the pages… */
const REPEAT_SHARE = 0.5
/** …and on at least this many pages, so short chapters are left alone. */
const MIN_REPEAT_PAGES = 3

/**
 * Fold a candidate line to the form used for comparison across pages: digits
 * become `#` (so "Page 12" and "Page 13" match) and whitespace/case are
 * flattened.
 */
export function normalizeHeaderCandidate(text: string): string {
  return text
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Is index `i` within the first or last {@link EDGE_LINES} lines of the page? */
function isEdgeLine(i: number, pageLength: number): boolean {
  return i < EDGE_LINES || i >= pageLength - EDGE_LINES
}

/**
 * Drop running headers, running footers and page numbers from a chapter's pages.
 *
 * Conservative by construction: a line is only ever considered when it sits in
 * the first or last two lines of its page, so a sentence that happens to repeat
 * mid-page always survives. Within that window a line is dropped when either
 *
 *  • its digit-folded form appears at the edge of more than half the pages (and
 *    of at least three pages) — a running head/foot, or
 *  • it is a standalone page number ("17", "3 of 40", "Page 3 / 40").
 *
 * Generic over the line type so callers keep their geometry (`y`, `height`);
 * lines are filtered, never rebuilt.
 */
export function stripRunningHeadersFooters<T extends TextLine>(
  pages: readonly T[][],
): T[][] {
  const seenOnPages = new Map<string, Set<number>>()
  pages.forEach((lines, pageIndex) => {
    lines.forEach((line, i) => {
      if (!isEdgeLine(i, lines.length)) return
      const key = normalizeHeaderCandidate(line.text)
      if (!key) return
      const pageSet = seenOnPages.get(key)
      if (pageSet) pageSet.add(pageIndex)
      else seenOnPages.set(key, new Set([pageIndex]))
    })
  })

  const threshold = pages.length * REPEAT_SHARE
  const running = new Set<string>()
  for (const [key, pageSet] of seenOnPages) {
    if (pageSet.size >= MIN_REPEAT_PAGES && pageSet.size > threshold) running.add(key)
  }

  return pages.map((lines) =>
    lines.filter((line, i) => {
      if (!isEdgeLine(i, lines.length)) return true
      const text = line.text
      if (PAGE_NUMBER_RE.test(text) || PAGE_OF_RE.test(text)) return false
      return !running.has(normalizeHeaderCandidate(text))
    }),
  )
}

// ── 4. Scene breaks ──────────────────────────────────────────────────────────

/**
 * Punctuation that can repeat in ordinary text and must never be read as a
 * scene divider: ellipses, quote runs, brackets.
 */
const NOT_A_DIVIDER = new Set([
  ".", ",", ";", ":", "!", "?", "…",
  "'", '"', "‘", "’", "“", "”", "«", "»",
  "(", ")", "[", "]", "{", "}", "<", ">", "/", "\\", "|",
])

/**
 * Dashes and rules are only a scene break when repeated — a single stray "-" or
 * "—" on its own line is far more often an extraction artifact or a dialogue
 * dash than a divider.
 */
const NEEDS_REPETITION = new Set(["-", "–", "—", "~", "_", "=", "+", "*"])

/**
 * Is this block a typographic scene break (`* * *`, `◇◇◇`, `~~~`, `###`, `---`)?
 *
 * Requires 1–10 repetitions of one non-letter, non-digit character, optionally
 * space-separated. Sentence punctuation is excluded, so `"..."` and `?!` stay
 * prose, and single dashes must repeat to count.
 */
export function isSceneBreak(text: string): boolean {
  const compact = text.replace(/\s+/g, "")
  if (compact.length < 1 || compact.length > 10) return false
  const ch = compact[0]
  if (/[\p{L}\p{N}_]/u.test(ch)) return false
  if (NOT_A_DIVIDER.has(ch)) return false
  for (const c of compact) if (c !== ch) return false
  if (compact.length === 1 && NEEDS_REPETITION.has(ch)) return false
  return true
}
