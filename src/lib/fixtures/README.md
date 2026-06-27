# Regression fixtures

Each `*.fixture.ts` here captures one real example we've fixed, so future changes
can't silently break it. They are run by [`../regression.test.ts`](../regression.test.ts),
which auto-discovers every `*.fixture.ts` via `import.meta.glob`.

## Run

```sh
npm test                 # all tests, including these fixtures
npx vitest regression    # just the regression suite (watch: drop "run")
```

## Add a case

Drop a new `NN-name.fixture.ts` that default-exports a [`Fixture`](./types.ts):

```ts
import { expect } from "vitest"
import type { Fixture } from "./types"

const fixture: Fixture = {
  name: "what this guards",
  // EITHER raw reconstructed lines (full assemble→render pipeline)…
  // lines: statLines(["line 1", "line 2", ...]),
  // …OR blocks straight to rendering:
  blocks: [{ type: "p", text: "Label: value Other: value" }],
  check(html, css) {
    expect(html).toContain("…")
  },
}
export default fixture
```

No wiring needed — the runner picks it up automatically.

## Current cases

1. `01-jackal-bullets` — "•" bullets each on their own line; section labels
   ("Subsume Results" / "Material Results") on their own lines.
2. `02-soul-stealer-abilities` — "Name: description" ability entries each break
   onto their own line; prose with a colon does NOT split.
3. `03-rarity-coloring` — bracketed/bare/`-grade` tier tags get the right rarity
   class; CSS/HTML never contains an invisible-text pattern (Kindle-safe).
4. `04-prismatic-defiance` — labeled fields each on their own line; `[Maestro: 1]`
   inner colon doesn't split; adjacent bracket runs stay together.
5. `05-prose-guard` — ordinary narrative prose passes through unchanged.
