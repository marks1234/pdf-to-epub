/**
 * Fetching one post's content: the JSON API first (`content` HTML, else the
 * `content_json_string` TipTap doc), the rendered post page as a fallback only
 * when the API answered but gave nothing usable. Every failure carries a
 * `kind` the run loop acts on. A post the account can't read is skipped, never
 * retried around — the extension only reads what the user already has.
 */
import type { Block } from "@/lib/reconstruct"

import { HttpError, isAbort, NotJsonError, type Http } from "./http"
import { postBodyFromPageHtml, postTitleFromPageHtml } from "./page-parse"
import { ApiShapeError, parsePost, postPageUrl, postUrl, type PostRef } from "./patreon-api"

export type FailureKind = "locked" | "missing" | "empty" | "transient" | "auth"

export type PostResult =
  | { ok: true; id: string; title: string; html: string; blocks?: Block[]; publishedAt?: string }
  | { ok: false; id: string; title: string; reason: string; kind: FailureKind }

const fallbackTitle = (ref: PostRef) => ref.title || `Post ${ref.id}`
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Rate limit, server error, or a network failure (not an API answer we can parse around). */
export function isTransient(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 408 || e.status === 429 || e.status >= 500
  return !(e instanceof ApiShapeError) && !(e instanceof NotJsonError) && !isAbort(e)
}

const isHtml = (ct: string | null) => !!ct && /html/i.test(ct)

export async function fetchPostContent(ref: PostRef, http: Http): Promise<PostResult> {
  const fail = (kind: FailureKind, reason: string, title = fallbackTitle(ref)): PostResult => ({ ok: false, id: ref.id, title, reason, kind })
  if (ref.canView === false) return fail("locked", "locked for your membership tier")

  let apiError: string
  try {
    const post = parsePost(await http.getJson(postUrl(ref.id)))
    const title = post.title || fallbackTitle(ref)
    const publishedAt = post.publishedAt ?? ref.publishedAt
    if (post.canView === false) {
      return fail("locked", post.html ? "API returned only a preview (locked for your tier)" : "locked for your membership tier", title)
    }
    if (post.html) return { ok: true, id: ref.id, title, html: post.html, publishedAt }
    if (post.blocks) return { ok: true, id: ref.id, title, html: "", blocks: post.blocks, publishedAt }
    apiError = "API returned no body"
  } catch (e) {
    if (isAbort(e)) throw e
    if (e instanceof NotJsonError) return fail("auth", e.message)
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      return isHtml(e.contentType) ? fail("auth", e.message) : fail("locked", "locked (access denied)")
    }
    if (e instanceof HttpError && e.status === 404) return fail("missing", "not found (deleted?)")
    if (isTransient(e)) return fail("transient", msg(e))
    apiError = msg(e) // ApiShapeError, 400, 410…: try the page
  }

  // Fallback: the post page. Patreon renders bodies client-side, so this often
  // has no body — but when the server does include one, it's the real thing.
  try {
    const page = await http.getText(postPageUrl(ref.id))
    const html = postBodyFromPageHtml(page)
    const title = postTitleFromPageHtml(page) || fallbackTitle(ref)
    if (html && html.replace(/<[^>]*>/g, "").trim()) {
      return { ok: true, id: ref.id, title, html, publishedAt: ref.publishedAt }
    }
    return fail("empty", `${apiError}; post page had no readable body`, title)
  } catch (e) {
    if (isAbort(e)) throw e
    return fail(isTransient(e) ? "transient" : "empty", `${apiError}; page failed (${msg(e)})`)
  }
}
