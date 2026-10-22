import { describe, it, expect } from "vitest"

import {
  collectionIdFromPath,
  parseCollectionDocTitle,
  postBodyFromPageHtml,
  postIdFromHref,
  postIdsFromCollectionHtml,
  postTitleFromPageHtml,
} from "./page-parse"

// Synthetic page with the same wrapper structure as a saved Patreon post page.
const POST_PAGE = `<html><body>
<div class="Header-module__aa11bb__root"><span data-tag="post-title" class="Typography-module__x__h">Test Book - Chapter 9 &amp; more</span></div>
<div class="patreon-post-content"><div class="PaddingTop-module__FYUbOa__x"><div class="PostBodies-module__JRIMpq__postContent">
<div class="TokenOverrides-module__yhJOLG__tokensPostPage"><div class="RichText-module__5kju5G__root RichText-module__5kju5G__extra">
<p></p><p>First line.</p><div><p>Nested <strong><em>Bold Italic</em></strong></p></div><p>Last line.</p>
</div></div></div></div></div>
<div class="Comments-module__q__root"><p>Not part of the body</p></div>
</body></html>`

describe("post page parsing", () => {
  it("extracts the RichText body inside .patreon-post-content, nested divs included", () => {
    const body = postBodyFromPageHtml(POST_PAGE)
    expect(body).toContain("<p>First line.</p>")
    expect(body).toContain("<p>Last line.</p>")
    expect(body).toContain("<div><p>Nested <strong><em>Bold Italic</em></strong></p></div>")
    expect(body).not.toContain("Not part of the body")
  })

  it("extracts the post title as text", () => {
    expect(postTitleFromPageHtml(POST_PAGE)).toBe("Test Book - Chapter 9 & more")
  })

  it("returns null when the body isn't rendered", () => {
    expect(postBodyFromPageHtml("<html><div id='root'></div></html>")).toBeNull()
    expect(postTitleFromPageHtml("<html></html>")).toBeNull()
  })

  it("only takes RichText inside the post-content wrapper", () => {
    expect(postBodyFromPageHtml('<div class="RichText-module__a__root"><p>About the creator</p></div>')).toBeNull()
    expect(
      postBodyFromPageHtml(
        '<div class="patreon-post-content"></div><div class="Comments"><div class="RichText-module__a__root"><p>comment</p></div></div>',
      ),
    ).toBeNull()
    expect(
      postBodyFromPageHtml('<div data-tag="post-content"><div class="RichText-module__a__root"><p>Body</p></div></div>'),
    ).toBe("<p>Body</p>")
  })
})

describe("collection page parsing", () => {
  it("parses the document title", () => {
    expect(parseCollectionDocTitle("Test Book | Collection from Writer | 178 posts | Patreon")).toEqual({
      title: "Test Book",
      creator: "Writer",
      postCount: 178,
    })
    expect(parseCollectionDocTitle("Patreon")).toEqual({})
  })

  it("reads the collection id from the path", () => {
    expect(collectionIdFromPath("/collection/552396")).toBe("552396")
    expect(collectionIdFromPath("/collection/552396/")).toBe("552396")
    expect(collectionIdFromPath("/posts/1")).toBeNull()
  })

  it("collects this collection's post ids in page order, de-duplicated", () => {
    const html =
      '<a href="https://www.patreon.com/posts/300?collection=9">a</a>' +
      '<a href="https://www.patreon.com/posts/300?collection=9">dup</a>' +
      '<a href="/posts/chapter-12-200?collection=9&amp;x=1">b</a>' +
      '<a href="https://www.patreon.com/posts/100?collection=8">other collection</a>' +
      '<a href="https://www.patreon.com/posts/50">no collection</a>'
    expect(postIdsFromCollectionHtml(html, "9")).toEqual(["300", "200"])
  })

  it("matches post links by id and collection", () => {
    expect(postIdFromHref("https://www.patreon.com/posts/123?collection=9", "9")).toBe("123")
    expect(postIdFromHref("https://www.patreon.com/posts/123?collection=99", "9")).toBeNull()
  })
})
