import { describe, it, expect } from "vitest"

import {
  DEFAULT_STYLER,
  assembleBlocks,
  blocksToHtml,
} from "@/lib/reconstruct"
import type { Fixture } from "./fixtures/types"

/**
 * Regression suite. Every example we've worked through is captured as a fixture
 * in ./fixtures/*.fixture.ts and asserted here, so a future fix can't silently
 * break an earlier one. To add a case, drop a new `*.fixture.ts` file in that
 * folder — it is picked up automatically below.
 */
const modules = import.meta.glob<{ default: Fixture }>("./fixtures/*.fixture.ts", {
  eager: true,
})

const fixtures = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, mod]) => ({ file: path.split("/").pop() as string, fx: mod.default }))

describe("regression fixtures", () => {
  it("discovers fixture files", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(5)
  })

  for (const { file, fx } of fixtures) {
    it(`${fx.name}  [${file}]`, () => {
      const blocks = fx.blocks ?? assembleBlocks(fx.lines ?? [])
      const html = blocksToHtml(blocks, DEFAULT_STYLER)
      fx.check(html, DEFAULT_STYLER.css)
    })
  }
})
