# Patreon Collection → EPUB (Chrome extension)

Saves a Patreon **collection you already have access to** as a single EPUB, for
reading offline on a Kindle or other e-reader. It reuses the main app's EPUB
pipeline (`chaptersToEpub`, LitRPG stat/rarity styling, EPUB 3 normalization).

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
3. After rebuilding, click the reload icon on the extension's card.

## Use

1. Log in to Patreon and open a collection page, e.g.
   `https://www.patreon.com/collection/552396`. Reload the page if you got
   there by clicking around inside Patreon (see Limitations).
2. Click **Download EPUB** (bottom right). The extension lists the collection,
   oldest chapter first: "178 chapters found".
3. Optionally narrow the range with **From** / **To**, then click **Start**.
   Posts are fetched one at a time with a pause of about 0.6–0.9 s between
   them, so 178 chapters take about 2–3 minutes. **Cancel** stops the run.
   Posts already fetched are kept, so starting again skips them.
4. The book downloads as `<Collection title>.epub`. A partial range is saved as
   `<title> (from-to).epub`. A summary lists any skipped posts and why.

## How it works

- **Listing**, tried in order until one gives a believable result (non-empty,
  overlaps the post links on the page, and not much bigger than the "N posts"
  count in the page title):
  1. `GET /api/posts?filter[collection_id]={id}&sort=collection_order&fields[post]=title,published_at,url&json-api-version=1.0`,
     following `links.next` (or a `meta.pagination.cursors.next` cursor).
  2. The same request without `sort`.
  3. `GET /api/collection/{id}?include=posts,campaign&…` (`post_ids`, or
     `relationships.posts`).
  4. Reading the page itself: clicking **Load more** until no new
     `/posts/{id}?collection={id}` links appear.

  The result is put oldest-first: collection order is kept (reversed if its
  dates run newest-first), otherwise sorted by `published_at`, then by the
  chapter number in the title, then a page listing is reversed.
- **Content**: `GET /api/posts/{id}?fields[post]=title,content,published_at,current_user_can_view&json-api-version=1.0`.
  If that request fails, it falls back to fetching `/posts/{id}` and reading
  `.patreon-post-content` → `[class^="RichText-module"]`. An empty body, a 401
  or 403, or `current_user_can_view: false` counts as a skipped post.
- **Politeness**: one request at a time, with a jittered 600–900 ms gap. A 429,
  5xx or network error is retried up to 3 times with exponential backoff, and
  `Retry-After` is honoured.
- **Formatting**: `<p>` becomes a paragraph. Bold, italic, underline,
  strikethrough and `<br>` are kept, including nested combinations, so a
  `<strong><em>` System line stays bold-italic. `text-align` center, right and
  justify become CSS classes. `h1`–`h6`, `blockquote`, lists and `<hr>` are
  kept. `* * *`-style lines become scene breaks. Other markup (links, images,
  spans, scripts, attributes) is reduced to plain text.
- **Building**: jepub compiles its templates with `new Function`, which MV3
  content scripts aren't allowed to run. So the EPUB is built in a sandboxed
  extension page (`sandbox.html`), loaded in a hidden iframe and reached over a
  private `MessageChannel`. If that frame can't load, the build is tried
  directly in the content script as a last resort.
- **Permissions**: host access to `https://www.patreon.com/*` only. The
  download uses a blob URL, so the `downloads` permission isn't needed.

## Limitations

- **Not yet tested against live Patreon.** The parsers have unit tests with
  synthetic fixtures, and the post-page parser was smoke-tested on a saved page.
  The API field names come from Patreon's web app and may change.
- The content script only runs on pages that were loaded at
  `/collection/...`. If you navigate to a collection inside Patreon's
  single-page app, reload the page so the button appears.
- Images, embeds, links and polls in posts are dropped. Only text and its
  basic formatting are kept.
- The cover is the collection's thumbnail if the API exposes it, otherwise
  Patreon's share card (`og:image`). If neither can be fetched as JPEG/PNG,
  the book has no cover.
- When the listing had to come from reading the page, chapter titles aren't
  known until each post is fetched (the range picker shows post IDs), and
  ordering by publish date happens after fetching.

## Development

Sources are in `src/`. The pure parts (HTML→blocks, API parsing and
pagination, ordering, page parsing, HTTP retry) have vitest tests that run
with the root `npm test`. `vite.config.ts` builds the IIFE bundles
(`--mode content` and `--mode sandbox`). `public/` holds `manifest.json` and
`sandbox.html`.
