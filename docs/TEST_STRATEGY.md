# Test strategy

## Layers

| Layer | Tool | Runs | Covers |
| --- | --- | --- | --- |
| Unit | Vitest (jsdom) | `npm test` | Pure logic, material rules, flags, state machines |
| Simulation | Vitest | `npm test` | Character motor against a real BVH |
| Smoke / E2E | Playwright | `npm run test:e2e` | The real game in a real browser |
| Budgets | Node script | `npm run check:budgets` | Bundle and asset size regressions |

`npm run verify` runs the complete non-destructive gate.

## Current state

**100 tests across 8 files**, all passing.

| File | Tests | Covers |
| --- | --- | --- |
| `world.test.ts` | 26 | Terrain/road continuity, corridor flatness, and the character motor against a real BVH — grounding, jumping, wall blocking, high-speed tunnelling at 60 m/s |
| `mathUtils.test.ts` | 15 | Clamping, frame-rate-independent damping, angle wrapping, seeded RNG determinism, noise continuity |
| `settings.test.ts` | 13 | Preset monotonicity, device detection, persistence, corrupt-storage recovery |
| `playerState.test.ts` | 11 | Every state transition, hysteresis bands, coyote time, hard vs soft landings |
| `input.test.ts` | 11 | Key mapping, diagonal normalisation, jump consumption, blur release |
| `collectibles.test.ts` | 9 | Persistence, stale-id rejection, reset, missing storage |
| `toonMaterial.test.ts` | 8 | Wind is opt-in — palette colour names must not trigger foliage shaders |
| `featureFlags.test.ts` | 7 | Flags default off; only documented on-forms enable them |

## Principles

**Test the bug you fixed.** Every defect found gets a test that fails without
the fix. `toonMaterial.test.ts` exists because `leaf_mid` — a *palette colour*
used for book spines and blankets — was handing furniture the tree wind
shader. `featureFlags.test.ts` exists because a flag that leaked on by default
would install a debug bridge into ordinary play.

**Prefer the seam over the scene graph.** Browser tests drive the game through
`window.__LH_TEST__`, not by reaching into internals. Ad-hoc capture is not
reproducible: during Phase 1 two apparent "regressions" turned out to be
different camera framing between runs.

**Object counts beat heap size for leak detection.** Heap is noisy because GC
timing varies. Geometries, textures and program counts returning to their
prior values after a round trip is the reliable signal.

## Determinism

Reproducible browser capture requires pinning:

1. **The clock** — `setTimeMode('day' | 'dusk' | 'night')` stops the cycle;
   `setTime(t)` pins an exact position.
2. **The dev readout** — `prepareShot()` injects a stylesheet hiding `#debug`,
   which survives its twice-a-second refresh.
3. **Camera framing** — `teleport()` then `frameCamera()`, never a manual
   drag.
4. **Settling** — `settle(frames)` advances fixed 1/60 s steps.

**Known residual variation:** clouds drift and birds animate off elapsed time,
and wind phase advances with `uTime`. `prepareShot()` does not currently
freeze these. Visual comparison must therefore use a **tolerance**, not exact
pixel equality. Pinning `uTime` and cloud/bird phase is the obvious next
improvement to the bridge.

## Test mode safety

- Installs only under `?e2e=1`; verified absent on a plain visit.
- Loaded by dynamic import, so it is not in the main chunk.
- A fixed set of typed operations against `TestSurface` — no scene-graph
  handle, no arbitrary evaluation.

## Gaps — honest list

- **No Playwright run on Firefox or WebKit yet.** The config exists; only
  Chromium has been exercised.
- **No visual-diff assertion.** Baseline screenshots are captured and compared
  by eye plus renderer counters. A pixel-diff with tolerance is not yet wired.
- **No mobile-hardware measurement.** The mobile frame budget is unverified.
- **No touch or gamepad coverage.** Both paths exist in the game and are
  untested.
- **No soak test in CI.** The 160 s memory soak was run by hand.

## Running

```bash
npm run verify
```

Individually: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run check:budgets`, `npm run test:e2e`.
