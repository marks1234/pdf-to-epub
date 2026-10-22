import type { BookRequest } from "./build"

export type SandboxRequest = { type: "ping" } | { type: "build"; book: BookRequest }

export type SandboxResponse =
  | { type: "pong" }
  | { type: "built"; blob: Blob; coverDropped: boolean }
  | { type: "error"; message: string }
