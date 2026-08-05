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

Measured after the Phase 1 modernization (three r185, Vite 7).

| Artefact | Baseline (r169/Vite 5) | Current | Budget (raw) |
| --- | --- | --- | --- |
| `three-*.js` | 573.51 kB | 621.74 kB | ≤ 700 kB |
| `index-*.js` | 204.62 kB | 208.28 kB | ≤ 260 kB |
| `gsap-*.js` | 70.44 kB | 70.04 kB | ≤ 90 kB |
| `bvh-*.js` | 48.82 kB | 56.59 kB | ≤ 75 kB |
| `index-*.css` | 15.47 kB | 15.46 kB | ≤ 24 kB |
| **JS total** | **897.4 kB** | **956.7 kB** | **≤ 1,100 kB** |
| **JS total, gzip** | 253.3 kB | 269.1 kB | ≤ 320 kB |

The three.js upgrade cost ~48 kB raw / ~12 kB gzip. Accepted: it removed all
five npm audit vulnerabilities and the duplicate-instance warning.

## Asset budget

| Group | Current | Budget |
| --- | --- | --- |
| GLB total | 953.0 kB | ≤ 1,200 kB |
| Audio total | 1,667.8 kB | ≤ 2,000 kB |
| `icon.png` | 237.4 kB | ≤ 300 kB |
| Assets subtotal | 2,858.2 kB | — |
| **`dist/` total** | **3,828.4 kB** | **≤ 4,200 kB** |

`dist/` total is assets *plus* the ~939 kB of JS/CSS and the HTML shell — not
just the contents of `public/`.

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

Two warnings are expected and come from Three's own program compile under
ANGLE/D3D:

```
THREE.WebGLProgram: Program Info Log: warning X3557: loop only executes for
1 iteration(s), forcing loop to unroll
```

A change in this count is a signal worth investigating.
