/**
 * Content-script side of the sandbox: embeds sandbox.html in a hidden iframe
 * and talks to it over a private MessageChannel (page scripts never see the
 * traffic). See sandbox.ts for why the build can't run in the content script.
 */
import { buildBook, type BookRequest } from "./build"
import type { SandboxRequest, SandboxResponse } from "./sandbox-protocol"

declare const chrome: { runtime: { getURL(path: string): string } }

export interface Builder {
  build(book: BookRequest): Promise<{ blob: Blob; coverDropped: boolean }>
}

export class SandboxBuilder implements Builder {
  private port: MessagePort | null = null
  private connecting: Promise<MessagePort> | null = null

  constructor(private readonly host: Element | ShadowRoot) {}

  private connect(timeoutMs: number): Promise<MessagePort> {
    if (this.port) return Promise.resolve(this.port)
    if (this.connecting) return this.connecting
    this.connecting = new Promise<MessagePort>((resolve, reject) => {
      const iframe = document.createElement("iframe")
      iframe.src = chrome.runtime.getURL("sandbox.html")
      iframe.setAttribute("aria-hidden", "true")
      iframe.tabIndex = -1
      iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden"
      const timer = setTimeout(() => {
        iframe.remove()
        reject(new Error("The EPUB builder frame didn't load."))
      }, timeoutMs)
      iframe.addEventListener("load", () => {
        const channel = new MessageChannel()
        channel.port1.onmessage = (e: MessageEvent<SandboxResponse>) => {
          if (e.data.type !== "pong") return
          clearTimeout(timer)
          channel.port1.onmessage = null
          this.port = channel.port1
          resolve(channel.port1)
        }
        // A sandboxed page has an opaque origin, so "*" is the only target that
        // works; the port, not the window, carries everything after this.
        iframe.contentWindow?.postMessage({ type: "connect" }, "*", [channel.port2])
        channel.port1.postMessage({ type: "ping" } satisfies SandboxRequest)
      })
      this.host.appendChild(iframe)
    })
    this.connecting.catch(() => {
      this.connecting = null
    })
    return this.connecting
  }

  /** Resolves true once the sandbox answers; false if it can't be reached. */
  async ready(timeoutMs = 8000): Promise<boolean> {
    try {
      await this.connect(timeoutMs)
      return true
    } catch {
      return false
    }
  }

  async build(book: BookRequest): Promise<{ blob: Blob; coverDropped: boolean }> {
    const port = await this.connect(8000)
    return new Promise((resolve, reject) => {
      port.onmessage = (e: MessageEvent<SandboxResponse>) => {
        const r = e.data
        if (r.type === "built") resolve({ blob: r.blob, coverDropped: r.coverDropped })
        else if (r.type === "error") reject(new Error(r.message))
      }
      port.postMessage({ type: "build", book } satisfies SandboxRequest)
    })
  }
}

/**
 * Build in the sandbox; if the sandbox frame can't be reached, try in the
 * content script directly (works only where `new Function` is permitted).
 */
export async function buildWithFallback(sandbox: SandboxBuilder, book: BookRequest) {
  if (await sandbox.ready()) return sandbox.build(book)
  try {
    return await buildBook(book)
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(`Couldn't build the EPUB: the builder frame was blocked and the direct build failed (${why}).`)
  }
}
