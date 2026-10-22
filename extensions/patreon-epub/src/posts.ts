/**
 * Fetching one post's content: the JSON API first, the rendered post page as a
 * fallback. A post the account can't read is reported as skipped, never retried
 * around — the extension only reads what the user already has access to.
 */
import type { Block } from "@/lib/reconstruct"

import { HttpError, isAbort, type Http } from "./http"
import { postBodyFromPageHtml, postTitleFromPageHtml } from "./page-parse"
import { parsePost, postPageUrl, postUrl, type PostRef } from "./patreon-api"

export type PostResult =
  | { ok: true; id: string; title: string; html: string; blocks?: Block[]; publishedAt?: string }
  | { ok: false; id: string; title: string; reason: string }

const fallbackTitle = (ref: PostRef) => ref.title || `Post ${ref.id}`

export async function fetchPostContent(ref: PostRef, http: Http): Promise<PostResult> {
  let apiError: string
  try {
    const post = parsePost(await http.getJson(postUrl(ref.id)))
    const title = post.title || fallbackTitle(ref)
    if (post.html) return { ok: true, id: ref.id, title, html: post.html, publishedAt: post.publishedAt ?? ref.publishedAt }
    if (post.blocks) {
      return { ok: true, id: ref.id, title, html: "", blocks: post.blocks, publishedAt: post.publishedAt ?? ref.publishedAt }
    }
    if (post.canView === false) return { ok: false, id: ref.id, title, reason: "locked for your membership tier" }
    return { ok: false, id: ref.id, title, reason: "no text content (locked, or image/video only)" }
  } catch (e) {
    if (isAbort(e)) throw e
    if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
      return { ok: false, id: ref.id, title: fallbackTitle(ref), reason: "locked (access denied)" }
    }
    if (e instanceof HttpError && e.status === 404) {
      return { ok: false, id: ref.id, title: fallbackTitle(ref), reason: "not found (deleted?)" }
    }
    apiError = e instanceof Error ? e.message : String(e)
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
    return { ok: false, id: ref.id, title, reason: `API failed (${apiError}); post page had no readable body` }
  } catch (e) {
    if (isAbort(e)) throw e
    const pageError = e instanceof Error ? e.message : String(e)
    return { ok: false, id: ref.id, title: fallbackTitle(ref), reason: `API failed (${apiError}); page failed (${pageError})` }
  }
}
