# Patreon Collection → EPUB (Chrome extension)

Saves a Patreon **collection you already have access to** as a single EPUB, for
reading offline on a Kindle or other e-reader. It reuses the main app's
chapter rendering and LitRPG stat/rarity styling, and writes the same EPUB 3
package the app produces.

It only fetches posts your logged-in account can already read, using the same
requests Patreon's own website makes. Locked or tier-gated posts are skipped and
listed. The output is for your **personal use**; don't redistribute creators'
work.

## Install

```sh
npm install            # once, at the repo root
npm run build:extension
```

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and select `extensions/patreon-epub/dist/`.
3. After rebuilding, click the reload icon on the extension's card, then reload
   any open Patreon tabs.

Needs Chrome 116 or newer. The extension asks for `storage` /
`unlimitedStorage` (to keep fetched chapters between visits) and host access to
`https://www.patreon.com/*` only.

## Use

1. Log in to Patreon and open a collection page, e.g.
   `https://www.patreon.com/collection/552396`. Getting there by clicking
   around inside Patreon works too; no reload needed.
2. Click **Download EPUB** (bottom right). The extension lists the collection,
   oldest chapter first: "178 chapters found". If it could only find part of
   the collection, it says so ("Found 150 of 178 posts — the book may be
   incomplete"). Posts your tier can't read are marked "(locked)".
3. Optionally narrow the range with **From** / **To**, then click **Start**.
   Up to 3 posts are fetched at once, with request starts at least ~250 ms
   apart, so 178 chapters take about a minute. **Cancel** stops the run.
4. The book downloads as `<Collection title>.epub` (a partial range as
   `<title> (from-to).epub`). If no download appears, click **Download again**.
   A summary lists posts that couldn't be downloaded (temporary problems, with a
   **Retry N failed posts** button) separately from posts that aren't included
   (locked, deleted or empty).

Fetched chapters are saved in the extension's storage for 30 days. Cancelling,
going Back, reloading the page or retrying never refetches them; the ready
screen shows "120 of 178 already saved". **Clear saved chapters** forgets them.

### Reporting a problem

When something goes wrong, click **Copy diagnostics** (on the error screen, the
summary, or an incomplete-listing warning) and paste the text into your report.
It contains request paths, query parameter *names*, status codes, content
types, timings, failed post ids and the *key names* of Patreon's API responses.
It never contains cookies, post text, titles or response bodies.

## How it works

- **Loading**: `content.js` is a ~0.5 KB bootstrap injected on every Patreon
  page. It checks the path and follows in-app navigation (Navigation API, with
  a 2 s poll fallback until that fires). Only on a collection page does it
  import `app.js` (the rest of the extension), so other Patreon pages pay
  almost nothing.
- **Listing**: `GET /api/collection/{id}?include=posts,campaign` first. If it
  lists exactly the expected number of posts (from the page title "N posts")
  with titles, that's the listing. Otherwise
  `GET /api/posts?filter[collection_id]={id}&sort=collection_order&page[count]=100`,
  following `links.next` (string or `{href}`) or a cursor, bounded by the
  expected count so an ignored filter stops within a few pages. Without sort
  only if the sort is rejected. Last resort: reading the page, clicking
  **Load more** (or scrolling) until no new post links appear. A short listing
  is never presented as complete.
- **Ordering**: collection order is kept unless its dates clearly (more than
  2:1) run newest-first. Other listings are sorted by date (undated posts stay
  next to their neighbours), else by chapter number (`Vol. 2 Ch 3`, `12.5`).
- **Content**: `GET /api/posts/{id}?fields[post]=title,content,content_json_string,published_at,current_user_can_view`.
  `content` HTML is used when present; otherwise `content_json_string`, the
  TipTap/ProseMirror document Patreon now often sends instead, is converted
  directly to blocks. The post page (`.patreon-post-content`) is a fallback
  only when the API answered without a body.
- **Reliability**: every request has a timeout (30 s, images 60 s). A 429
  slows the whole run and honours `Retry-After`; the first 429/503 also drops
  to one request in flight (back up after 20 successes). Three temporary
  failures in a row pause the run (30 s, 60 s, 120 s, or until you're back
  online), then retry those posts; after that it stops and keeps what it has.
  A login page, Cloudflare check or repeated "access denied" triggers a check
  of the session; if you're logged out, it stops instead of building a hollow
  book.
- **Formatting**: paragraphs, bold, italic, underline, strikethrough and line
  breaks are kept, including nested combinations, so a bold-italic System line
  stays bold-italic. Alignment, headings, block quotes, lists and scene breaks
  (`<hr>`, `* * *`) are kept. Links, images and embeds are reduced to text.
- **Building**: an eval-free EPUB 3 writer (`src/epub-writer.ts`, JSZip only),
  because jepub's templates need `new Function`, which MV3 forbids. The
  download link lives inside the panel's closed shadow root, so Patreon's
  router can't intercept it.

## Limitations

- **Partly verified against live Patreon.** `content_json_string` was
  confirmed live; most other behaviour (page sizes, pagination shape, rate
  limits, locked/logged-out responses, the collection page DOM) is built from
  Patreon's web app and synthetic tests, and may need adjusting.
- Images, embeds, links and polls in posts are dropped.
- The cover is the collection's thumbnail if the API exposes it, otherwise
  Patreon's share card (`og:image`, only if it belongs to this collection). If
  neither can be fetched as a JPEG/PNG up to 5 MB, the book has no cover.
- When the listing had to come from reading the page, chapter titles aren't
  known until each post is fetched, and ordering by date happens after.
- Only one book is fetched at a time. Navigating away during a fetch keeps the
  panel on screen until the book is done; it moves to the new page on the next
  navigation after that.

## Development

Sources are in `src/`. Everything except `app.ts` / `bootstrap.ts` has vitest
tests that run with the root `npm test` (DOM pieces use small fakes; there is
no jsdom). `vite.config.ts` builds `dist/app.js` (ES module) and
`dist/content.js` (IIFE bootstrap); `public/` holds `manifest.json`.

The build fails if either bundle contains `new Function` or `eval(`. To check
by hand: `grep -cE "new Function|eval\(" extensions/patreon-epub/dist/*.js`
(expect 0 for both). Don't import values from `@/lib/epub-book` (type imports
are fine).
