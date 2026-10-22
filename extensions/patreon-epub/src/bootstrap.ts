/**
 * The content script injected on every https://www.patreon.com/* page
 * (dist/content.js). It must cost next to nothing on pages that aren't
 * collections: a path check, plus navigation listeners. Only when a
 * collection path shows up does it import the real app (dist/app.js).
 *
 * Navigation: content scripts run in an isolated world, so patching
 * `history.pushState` here would never see the page's own calls. Instead it
 * listens to the Navigation API (`currententrychange` fires for pushState /
 * replaceState / traversals; Chrome 102+) and `popstate`, with a 2 s poll as a
 * fallback that stops as soon as the Navigation API fires.
 */
declare const chrome: { runtime: { getURL(path: string): string } }

interface AppModule {
  sync(): void
}

const COLLECTION = /\/collection\/(?:[^/]*?-)?\d+(?:[/-]|$)/

let app: Promise<AppModule | null> | null = null
let lastPath = ""

function check(): void {
  if (location.pathname === lastPath) return
  lastPath = location.pathname
  if (app) {
    void app.then((m) => m?.sync())
    return
  }
  if (!COLLECTION.test(lastPath)) return
  app = (import(/* @vite-ignore */ chrome.runtime.getURL("app.js")) as Promise<AppModule>).then(
    (m) => {
      m.sync()
      return m
    },
    (e: unknown) => {
      console.error("[patreon-epub] failed to load", e)
      app = null
      lastPath = ""
      return null
    },
  )
}

let poll: ReturnType<typeof setInterval> | undefined = setInterval(check, 2000)
function onNavigate(): void {
  if (poll !== undefined) {
    clearInterval(poll)
    poll = undefined
  }
  // The URL may update just after the event; check now and once more shortly.
  check()
  setTimeout(check, 50)
}

const nav = (globalThis as { navigation?: EventTarget }).navigation
nav?.addEventListener("currententrychange", onNavigate)
// popstate alone doesn't cover pushState, so it never stops the fallback poll.
addEventListener("popstate", check)
check()
