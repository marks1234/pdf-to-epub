/**
 * Runs inside sandbox.html — a sandboxed extension page, the one place in an
 * MV3 extension where `new Function` is allowed. jepub renders its templates
 * through EJS, which compiles them with `new Function`, and MV3 content scripts
 * forbid that; so the content script hands the finished chapters here and gets
 * the EPUB Blob back.
 *
 * Protocol: the parent posts `{ type: "connect" }` with a MessagePort; all
 * further traffic (ping / build) goes over that private port.
 */
import { buildBook } from "./build"
import type { SandboxRequest, SandboxResponse } from "./sandbox-protocol"

window.addEventListener("message", (event) => {
  // Only the embedding page (our content script) may connect.
  if (event.source !== window.parent) return
  const data = event.data as { type?: string } | null
  if (data?.type !== "connect" || !event.ports[0]) return
  const port = event.ports[0]
  port.onmessage = async (msg: MessageEvent<SandboxRequest>) => {
    const req = msg.data
    const reply = (r: SandboxResponse) => port.postMessage(r)
    if (req.type === "ping") return reply({ type: "pong" })
    if (req.type === "build") {
      try {
        const { blob, coverDropped } = await buildBook(req.book)
        reply({ type: "built", blob, coverDropped })
      } catch (e) {
        reply({ type: "error", message: e instanceof Error ? e.message : String(e) })
      }
    }
  }
})
