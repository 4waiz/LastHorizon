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

**433 tests across 21 files**, all passing. Measured 2026-08-06, after Phase 4.

| File | Tests | Covers |
| --- | --- | --- |
| `clocks.test.ts` | 41 | Life, world and story clocks; gating sets, birthday carry-over, why none derives from another |
| `inventory.test.ts` | 39 | Stacks, slot limits and exempt kinds, equipment/wardrobe migration, the four soft needs and their accessibility switches |
| `zones.test.ts` | 37 | Manifests, streaming hysteresis, spawn resolution, disposal ownership |
| `save.test.ts` | 36 | Versioning, v1 to v2 migration, read-back-and-compare writes, validation that refuses to strand a player |
| `interaction.test.ts` | 32 | Distance, facing and availability filtering; the press latch; hold completion; the selector |
| `world.test.ts` | 26 | Terrain/road continuity, corridor flatness, and the character motor against a real BVH — grounding, jumping, wall blocking, high-speed tunnelling at 60 m/s |
| `animationLayers.test.ts` | 25 | Layer weights and interrupted fades, additive conversion on a clone, procedural foot placement, the socket table against the rig |
| `settings.test.ts` | 22 | Preset monotonicity, device detection, persistence, corrupt-storage recovery, per-need accessibility options |
| `simulation.test.ts` | 22 | Fixed-step accumulator, determinism, spiral-of-death guard |
| `ageAppearance.test.ts` | 21 | Proportions written to the bones the clips do not key; stoop applied after the mixer; GLTFLoader's bone-name sanitisation |
| `gates.test.ts` | 19 | Age and mode gates, Free Roam options |
| `ageStages.test.ts` | 17 | Half-open age bands, blending across a birthday, proportion interpolation |
| `mathUtils.test.ts` | 15 | Clamping, frame-rate-independent damping, angle wrapping, seeded RNG determinism, noise continuity |
| `worldInteractables.test.ts` | 15 | The village's fixed interactables as typed actions: indoor/outdoor gating, facing, priority, sitting |
| `cityRuntime.test.ts` | 13 | District runtime contract, map data |
| `input.test.ts` | 11 | Key mapping, diagonal normalisation, jump consumption, blur release |
| `playerState.test.ts` | 11 | Every state transition, hysteresis bands, coyote time, hard vs soft landings |
| `collectibles.test.ts` | 9 | Persistence, stale-id rejection, reset, missing storage |
| `toonMaterial.test.ts` | 8 | Wind is opt-in — palette colour names must not trigger foliage shaders |
| `cityBuilder.test.ts` | 7 | Chunk geometry, instancing |
| `featureFlags.test.ts` | 7 | Flags default off; only documented on-forms enable them |

### Browser scenarios

**25 Playwright scenarios**, green in Chromium, each asserting zero console
errors.

| Spec | Scenarios | Covers |
| --- | --- | --- |
| `interaction.spec.ts` | 7 | Prompts, facing, priority, seated, the selector, busy states |
| `smoke.spec.ts` | 6 | Boot, day/night, interior round trip, sit/wardrobe/lie, bridge absence |
| `persistence.spec.ts` | 4 | Needs drain on active seconds, blocked clock, save round trip |
| `ageing.spec.ts` | 4 | Proportions on the real rig, a birthday, the stoop, no scene growth |
| `gestures.spec.ts` | 4 | Three upper-body overlays over locomotion, ramping, replay |

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
timing varies. Geometries, textures and program counts are the reliable signal.

**Compare lap two against lap one, not lap one against the start.** The first
interior entry *builds* the room: 132 geometries to 156, once, and flat at 156
for every lap after it. A test that allowed "+4 over the starting count" was
measuring lazy initialisation and would have gone on failing however healthy the
code was. What "no leak" means is that a second round trip allocates nothing the
first did not — and only that form would catch a real one.

**Drive the real game, not just the module.** Phase 3 shipped five bugs that
passed every unit test while the running game was broken. Phase 4 found six more
the same way, none of them visible to `tests/`: an interact button that re-fired
on whatever the first action brought into range, an additive clip corrupted by
being converted in place, and `AgeAppearance` silently finding 6 of 20 bones
because `GLTFLoader` strips the dot out of `shoulder.L`. Every one of those needed
the browser.

**Make the test read state back, not repeat it.** `getAppearance()` reports what
is actually on the live bones rather than the proportions that were requested.
Reporting the input would have answered the wrong question and passed regardless
of whether anything reached the skeleton.

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
- **No touch or gamepad coverage.** The touch interact button now reports press
  *and* release, so hold-to-act works there, but neither path is tested. There
  is no gamepad code in the repository at all — the phase brief listed it, and
  claiming coverage would be claiming a feature.
- **Hold-to-act is unit-tested but unused in game.** `holdSeconds` works and has
  tests; every fixed interactable in the village is a press.
- **No soak test in CI.** The 160 s memory soak was run by hand.

## Running

```bash
npm run verify
```

Individually: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run check:budgets`, `npm run test:e2e`.
