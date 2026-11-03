# Royal Road → EPUB (Chrome extension)

Saves a Royal Road fiction as one EPUB (cover, table of contents, one chapter
per page, author's notes optional) for personal offline reading, e.g. on a
Kindle. It runs in your own browser, so Royal Road's Cloudflare check and your
login work as normal. Chapters are fetched one at a time (~0.7 s apart, with
backoff on 429/5xx). Don't redistribute authors' work.

## Install

```sh
npm install
npm run build:extension:royalroad
```

`chrome://extensions` → **Developer mode** → **Load unpacked** →
`extensions/royalroad-epub/dist/`.

## Use

1. Open a fiction page, e.g. `https://www.royalroad.com/fiction/21220/mother-of-learning`.
2. Click **📖 Download EPUB** (bottom right), optionally pick a chapter range and
   whether to include author's notes, then **Start**.
3. The book downloads as `<Title>.epub`. Send it to Kindle at
   <https://www.amazon.com/sendtokindle> (EPUB is supported), or email it to
   your `@kindle.com` address.

If Cloudflare interrupts a long run, reload the page and click Start again;
chapters already fetched in that tab are kept.

The EPUB is written by the Patreon extension's eval-free writer
(`../patreon-epub/src/epub-writer.ts`) with the app's default styler.
