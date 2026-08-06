# Performance budgets

Every figure here was measured on the Phase 1 baseline, not estimated. See
`docs/PHASE_01_BASELINE.md` for how. Budgets are enforced by
`scripts/check-budgets.mjs`, which runs in CI and fails the build on an
unexplained regression.

**Reference machine:** Windows 11, Node 24, Chromium via Playwright, DPR 1.5,
canvas 1554×1273, High quality preset auto-selected.

---

## The rule that surprises people

**The interior is the worst case, not the open village.**

| Scene | Draw calls | Triangles |
| --- | --- | --- |
| Village, day | 285 | 482,488 |
| Village, night | 377 | ~482,000 |
| **Interior** | **183** | **~780,000** |

`WindowPortal` renders the outdoor world a second time into a half-resolution
target so the windows parallax correctly. Draw calls drop indoors because the
room is small; triangle load rises ~61%. Budget against the interior.

Night is the outdoor peak for draw calls (377) as the lamp point-light pool
engages.

## Frame budget

| Metric | Baseline | Budget | Fail |
| --- | --- | --- | --- |
| Average FPS (desktop) | 60.2 | ≥ 58 | < 50 |
| Median frame | 16.7 ms | ≤ 17 ms | > 20 ms |
| p95 frame | 16.8 ms | ≤ 20 ms | > 28 ms |
| Worst frame (steady state) | 17.2 ms | ≤ 33 ms | > 50 ms |

Mobile target is 30 FPS sustained at the Medium preset. Not yet measured on
real hardware — **this is an unverified budget** and must be confirmed before
any release claim.

## Scene budget

| Metric | Baseline | Budget |
| --- | --- | --- |
| Draw calls, outdoor day | 285 | ≤ 340 |
| Draw calls, outdoor night | 377 | ≤ 430 |
| Draw calls, interior | 183 | ≤ 240 |
| Triangles, outdoor | 482 k | ≤ 560 k |
| Triangles, interior | 780 k | ≤ 880 k |
| Shader programs | 40 | ≤ 55 |
| Geometries | 198 | ≤ 260 |
| Textures | 17 | ≤ 32 |

Program count is the one to watch: material sharing plus
`customProgramCacheKey` is what keeps ~99 imported materials on ~23–40
programs. A change that multiplies programs will not show up as a frame-rate
cliff immediately, but it fragments batching.

## Bundle budget

Measured after Phase 5. The baseline column is pre-Phase-1 (three r169, Vite 5);
"Phase 1" is the figure that column was first compared against. Sizes are
1000-based kB, as reported by the build; `check-budgets.mjs` uses 1024-based,
so its numbers read a few per cent lower.

| Artefact | Baseline (r169/Vite 5) | Phase 1 | Current | Budget (raw) |
| --- | --- | --- | --- | --- |
| `three-*.js` | 573.51 kB | 621.74 kB | 623.67 kB | ≤ 700 kB |
| `index-*.js` | 204.62 kB | 208.28 kB | 287.60 kB | ≤ 300 kB |
| `gsap-*.js` | 70.44 kB | 70.04 kB | 70.04 kB | ≤ 90 kB |
| `bvh-*.js` | 48.82 kB | 56.59 kB | 56.59 kB | ≤ 75 kB |
| `index-*.css` | 15.47 kB | 15.46 kB | 15.69 kB | ≤ 24 kB |
| **JS total (startup)** | **897.4 kB** | **956.7 kB** | **1,037.9 kB** | **≤ 1,100 kB** |
| `rapier-*.js` *(lazy)* | — | — | 2,237.40 kB | ≤ 2,400 kB |
| `TestMode-*.js` *(lazy)* | — | — | 2.20 kB | — |

### Startup versus shipped, split in Phase 5

Until Phase 5 every byte in `dist/` was downloaded before the first frame, so a
single total measured both "how much do we ship" and "how long until the player
is playing". Rapier broke that. It is **2,237 kB** — the `-compat` build inlines
its 1.57 MB WebAssembly as base64 — and it more than doubles the shipped bytes
while adding nothing to startup, because it arrives through a dynamic `import()`
that only runs when a vehicle needs it. Someone who never gets on a bicycle
never fetches it.

Collapsing the two into one number would mean either failing the build over
bytes nobody waits for, or raising the total until it stopped protecting load
time at all. So there are now two:

| Measure | Covers | Phase 4 | Phase 5 | Budget |
| --- | --- | --- | --- | --- |
| **initial load** | everything except lazy chunks | 3,913.6 kB | 3,917.1 kB | ≤ 4,200 kB |
| **shipped total** | everything in `dist/` | 3,913.6 kB | 6,104.2 kB | ≤ 6,600 kB |

**Adding a physics engine cost the loading screen 3.5 kB.** That is the whole
point of the split, and it is the number to watch: if `initial load` starts
climbing, something that should be lazy is not.

`JS total` counts startup chunks only, for the same reason.

### Rapier: `-compat` versus the plain package, and why we kept `-compat`

`@dimforge/rapier3d` (no `-compat`) ships the `.wasm` as a separate file rather
than base64 inside the JS. That is roughly 670 kB smaller raw and around 230 kB
smaller gzipped, and the browser gets to cache the WebAssembly independently of
the glue.

It is not taken here because `-compat` needs no Vite WASM configuration and this
repository has already lost time to a native/WASM toolchain fight
(`docs/adr/0002-vite-7-not-8.md`). Swapping the package is a dependency change,
and the rule is one at a time with the full gate between — doing it in the
middle of building the vehicle system would confound a physics bug with a
loader bug. It is a worthwhile follow-up, on its own, with before/after
measurements.

The three.js upgrade cost ~48 kB raw / ~12 kB gzip. Accepted: it removed all
five npm audit vulnerabilities and the duplicate-instance warning.

### The app chunk budget, raised from 260 kB to 300 kB in Phase 4

Phases 2–4 put roughly 74 kB of new gameplay code in the app chunk, and none of
it is separable: zone streaming and the city runtime, three clocks, the
versioned save service, gates, the interaction system, inventory, equipment,
needs, age stages and the appearance rig. It is all reached from the first
frame, so code-splitting it would trade bundle size for a stall on load.

300 kB is deliberately close — about 9% of headroom. The next phase that wants
more has to come back and justify it here rather than absorb it quietly. If it
needs to go much higher, the answer is probably to split the city runtime out
behind the zone-travel boundary, where a load pause is already expected.

## Asset budget

| Group | Current | Budget |
| --- | --- | --- |
| GLB total | 965.3 kB | ≤ 1,200 kB |
| Audio total | 1,667.8 kB | ≤ 2,000 kB |
| `icon.png` | 237.4 kB | ≤ 300 kB |

Totals live under "Bundle budget" above, split into **initial load** (≤ 4,200 kB)
and **shipped total** (≤ 6,600 kB). Both are assets *plus* JS/CSS and the HTML
shell, not just the contents of `public/`.

Meshopt is wired up in `AssetManager`; at this size the decoder costs more
than it saves. Revisit past ~2 MB of GLB.

## Memory

Sampled every 10 s, day/night cycle running, player outdoors:

- Heap 24.1–28.8 MB, **net negative drift** over the run.
- Geometries (198), textures (17) and programs (40) exactly constant.

**Fail condition:** monotonic heap rise across a soak, or any of those three
counts growing after a zone/interior round trip. Object-count growth is the
reliable leak signal; heap alone is noisy because of GC timing.

## Console

**Zero errors** is the budget.

Warnings are expected from three sources, and only these three:

1. Three's own program compile under ANGLE/D3D:
   ```
   THREE.WebGLProgram: Program Info Log: warning X3557: loop only executes for
   1 iteration(s), forcing loop to unroll
   ```
2. Two three.js deprecations the app still triggers — `THREE.Clock` (use
   `THREE.Timer`) and `PCFSoftShadowMap`. Both are ours to fix and are open
   debt, not accepted noise.
3. Rapier's own wasm-bindgen glue, once physics has loaded:
   ```
   using deprecated parameters for the initialization function; pass a single
   object instead
   ```
   This one is **not** fixable from the call site. `init.d.ts` declares
   `init(): Promise<void>` — it takes no arguments, so there is no other form
   to pass. The warning is emitted inside the dependency's bundled glue. It
   appears only after a vehicle has triggered the lazy load, never on startup.

A change in this count is a signal worth investigating.
