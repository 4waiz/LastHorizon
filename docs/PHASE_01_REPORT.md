# Phase 1 report — Foundation, audit, modernization, guardrails

**Date:** 2026-08-05
**Starting point:** `dc97fed` on `main`
**Result:** `npm run verify` green; 100 tests; 0 console errors; 0 npm audit
vulnerabilities.

The measured pre-change baseline lives in
[PHASE_01_BASELINE.md](PHASE_01_BASELINE.md) and is the reference for every
before/after number below.

---

## 1. Dependency modernization

One major at a time, full gate between each.

| Package | Before | After | Notes |
| --- | --- | --- | --- |
| three | 0.169.0 | **0.185.1** | target met |
| @types/three | 0.169.0 | **0.185.4** | |
| three-mesh-bvh | 0.8.3 | **0.9.14** | removed the duplicate-instance warning |
| typescript | 5.9.3 | **6.0.3** | **not 7** — see below |
| vite | 5.4.21 | **7.3.6** | **not 8** — see below |
| vitest | 2.1.9 | **4.1.10** | target met |
| jsdom | 25.0.1 | **30.0.1** | |
| eslint | 8.57.1 | **10.8.0** | migrated to flat config |
| @typescript-eslint (split) | 8.65.0 | **typescript-eslint 8.66.0** | umbrella package |
| gsap | 3.15.0 | 3.15.0 | already current |
| @types/node | 26.1.2 | 26.1.2 | already current |
| @playwright/test | — | **1.62.1** | new |
| @eslint/js, globals | — | 10.0.1, 17.9.0 | new, for flat config |

**`npm audit`: 5 vulnerabilities (1 critical, 1 high, 3 moderate) → 0.**

### Deviation 1 — TypeScript 6.0.3, not 7.0.2

`typescript@latest` is 7.0.2. `@typescript-eslint` 8.66.0 — the newest release,
with no v9 — declares `peerDependencies: { typescript: ">=4.8.4 <6.1.0" }`.
TypeScript 7 is unsupported by the only available lint toolchain, so adopting
it means either a broken `npm run lint` or a blanket disable. Both are barred
by the phase rules and by acceptance criterion 3. **6.0.3 is the newest
release inside the supported range.** The brief's "TypeScript 6" was correct
and `latest` was a trap.

### Deviation 2 — Vite 7.3.6, not 8.2.0

Vite 8.2.0 was installed and the config migrated correctly for it (Rolldown
renames `rollupOptions` → `rolldownOptions` and removes object-form
`manualChunks` in favour of `advancedChunks.groups`). The build then failed:

```
Error: An Application Control policy has blocked this file.
...\@rolldown\binding-win32-x64-msvc\rolldown-binding.win32-x64-msvc.node
```

npm's error text blames a known optional-dependency bug; that is a red
herring — the binary was present at 20.8 MB. The real cause is this host:
`VerifiedAndReputablePolicyState = 1`, i.e. **Windows Smart App Control
enforced**, refusing Rolldown's unsigned native binding. The documented WASM
fallback loaded but could not resolve the config entry under WASI.

Disabling Smart App Control was rejected: it is machine-wide and **cannot be
re-enabled without reinstalling Windows**. `npm ls rolldown` showed exactly one
path into the tree (`vite@8.2.0 → rolldown@1.2.3`), and Vitest 4 accepts
`vite ^6 || ^7 || ^8` without Rolldown, so dropping to Vite 7 keeps the Vitest
target intact. Full reasoning and the re-upgrade recipe:
[adr/0002-vite-7-not-8.md](adr/0002-vite-7-not-8.md).

**This is a host constraint, not an inherent one** — Linux CI has no Smart App
Control and would load the native binding normally.

### Deprecations — fixed, not suppressed

| Deprecation | Fix | Verified by |
| --- | --- | --- |
| `MeshBVH({ maxLeafTris })` | → `targetLeafSize` ([CollisionWorld.ts:67](../src/physics/CollisionWorld.ts)) | `index.d.ts` marks it `@deprecated`; `buildTree.js` uses the new name as the identical leaf threshold |
| `baseUrl` deprecated in TS 6, removed in 7 | dropped from tsconfig; `paths` now `./src/*` | compiler error TS5090 guided the exact form |
| ESLint 10 `no-useless-assignment` | dead `node` binding scoped into its `try` ([AudioManager.ts:182](../src/core/AudioManager.ts)) | genuine dead store, not a false positive |

---

## 2. Regression evidence

At identical camera state, post-migration counters are **identical** to the
pre-migration baseline:

| Metric | Baseline (r169, Vite 5) | After |
| --- | --- | --- |
| Draw calls, village day | 285 | **285** |
| Triangles, village | 482,488 | **482,488** |
| Triangles, interior | 778–780 k | **780,126** |
| Shader programs | 40 | **40** |
| Console errors | 0 | **0** |

Enter/exit interior, sit, wardrobe and lie all verified working.

Two warnings persist, unchanged and benign: `X3557: loop only executes for 1
iteration(s)` from Three's own program compile under ANGLE/D3D.

---

## 3. Bug fixed: foliage wind leaking onto buildings and furniture

Reported as "roof and house not attached". **Pre-existing; not caused by the
upgrade.**

`leaf_*`, `bush*` and `palm_frond` are **palette colour names** in the Blender
kit, not foliage markers. `toonFromImported` matched on the name and handed the
tree-canopy wind shader to:

- HouseLarge's dormer window box — five 24 cm plants painted `leaf_mid`
  ([build_buildings.py:169](../scripts/blender/build_buildings.py))
- interior furniture — bed blanket, book spines, pens, framed pictures
  (`leaf_teal` / `leaf_mid`)

The dormer case was severe because the sway mask uses **object-space** height
against a 4.5 m reference:

```glsl
float lhH = clamp(position.y / 4.50, 0.0, 1.6);
float lhMask = lhH * lhH;
```

At y ≈ 6.5 that yields `lhMask ≈ 2.09` — over twice a full tree canopy — with
peak displacement larger than the 24 cm plant itself. The plants swung out of
their planter at the roofline and read as detached geometry.

**Fix:** wind, occluder fade and double-siding are now opt-in
(`toonFromImported(..., { allowWind: true })`), requested only by
`Vegetation.ts`, where everything genuinely is vegetation.

| | Before | After |
| --- | --- | --- |
| Building wind materials | 2 | **0** |
| Interior wind materials | 2 | **0** |
| Vegetation wind meshes | 17 | **17** |
| Draw calls | 285 | 282 (those meshes now batch with solids) |

Covered by 8 tests in `tests/toonMaterial.test.ts`.

---

## 4. What was built

| Deliverable | Where |
| --- | --- |
| Engineering rules | `CLAUDE.md` |
| Vision | `docs/GAME_VISION.md` |
| Architecture | `docs/ARCHITECTURE_V2.md` |
| Budgets | `docs/PERFORMANCE_BUDGETS.md` |
| Test strategy | `docs/TEST_STRATEGY.md` |
| Asset provenance | `docs/ASSET_LICENSES.md` |
| ADRs | `docs/adr/0001-renderer-backend.md`, `0002-vite-7-not-8.md` |
| Typed feature flags | `src/core/FeatureFlags.ts` |
| Deterministic test mode | `src/core/TestMode.ts`, `Game.testSurface()` |
| Renderer seam | `src/core/RendererBackend.ts` |
| Budget gate | `scripts/check-budgets.mjs` |
| CI | `.github/workflows/ci.yml` |
| Smoke tests | `tests/e2e/smoke.spec.ts`, `playwright.config.ts` |

**Test bridge:** `window.__LH_TEST__` installs only under `?e2e=1`, via dynamic
import so it stays out of the main chunk. Verified present with the flag and
**absent without it**. It exposes a fixed set of typed operations against a
narrow `TestSurface` — no scene-graph handle, no arbitrary evaluation.

**Screenshot sink: kept.** `vite.config.ts` gates it with `apply: 'serve'` and
`window.__lh` sits behind `import.meta.env.DEV`. Grepping `dist` for `__shot`,
`__cap`, `lh-shot-sink`, `__view`, `__free`, `__top` and `__lh` returns
nothing. The budget gate now asserts this on every build, and a smoke test
asserts `/__cap.js` 404s in production.

---

## 5. README corrections

| Claim | Reality |
| --- | --- |
| "79 tests" | **100** |
| "There are no audio files" | 1.67 MB of MP3 ships and layers over the synth bed |
| "~450 draw calls" | 285 day / 377 night / 183 interior |
| "≈ 850 KB of GLB" | 953 kB GLB **plus** 1.67 MB audio |
| "Vitest prints a Multiple instances of Three.js warning" | No longer true after three-mesh-bvh 0.9 |

Audio provenance was **unresolvable from the repository** and was confirmed by
the author as original first-party work; recorded in `ASSET_LICENSES.md`. The
"every asset is original" claim therefore stands, with the "no audio files"
sentence corrected.

---

## 6. Budgets, before and after

| Artefact | Before | After | Budget |
| --- | --- | --- | --- |
| three chunk | 573.5 kB | 607.2 kB | ≤ 700 kB |
| app chunk | 204.6 kB | 206.8 kB | ≤ 260 kB |
| gsap chunk | 70.4 kB | 68.4 kB | ≤ 90 kB |
| bvh chunk | 48.8 kB | 55.3 kB | ≤ 75 kB |
| stylesheet | 15.5 kB | 15.1 kB | ≤ 24 kB |
| **JS total** | **897.4 kB** | **939.0 kB** | ≤ 1,100 kB |
| dist total | — | 3,828.4 kB | ≤ 4,200 kB |

Three r185 cost ~34 kB raw on its chunk. Accepted: it cleared five audit
vulnerabilities and the duplicate-instance warning.

---

## 7. Known risks and gaps

**Honest list. None of these is closed.**

1. **No Playwright run on Firefox or WebKit yet.** Config and CI matrix exist;
   only Chromium has been exercised locally. Acceptance criterion 4 is
   therefore **not yet demonstrated**.
2. **No pixel-diff visual regression.** Baselines are captured and compared by
   eye plus renderer counters. `prepareShot()` pins the clock and the dev
   readout but **does not freeze cloud drift, bird animation or wind phase**,
   so comparison needs a tolerance. Pinning `uTime` is the next bridge
   improvement.
3. **Mobile frame budget is unverified** — no real device measured.
4. **Touch and gamepad paths untested.**
5. **CI has never run.** The workflow is written but unexecuted; expect the
   usual first-run corrections, especially WebGL under SwiftShader.
6. **`dist/` is committed**, so build output can drift from source.
7. **GSAP's license is not OSI open-source.** Free for most uses, but terms
   differ for paid products — confirm against the intended commercial model.
8. **Vite is one major behind** by host constraint (see above).
9. **Root-level duplicate assets retained** at the author's request:
   `indoor.mp3`, `outdoor.mp3` (1.63 MB, byte-identical to the served copies)
   and a larger `icon.png`. Not served; pure git weight.

---

## 8. WebGPU recommendation

**Do not adopt WebGPU yet.** Concretely: not before the toon materials are
ported to TSL and verified under WebGL2.

The look is not post-processing — it is `onBeforeCompile` patches on shared
materials: the three-band ramp, foliage wind, the Bayer-dither occluder fade,
and a `customProgramCacheKey` that collapses ~99 imported materials onto ~23
programs. **`WebGPURenderer` does not call `onBeforeCompile`.** Pointing the
scene at it does not port the art direction; it silently deletes it, and
fragments batching.

There is also no problem to solve: 60.2 avg FPS, p95 16.8 ms, 285 draw calls.

**Recommended sequence, when it is worth doing:**

1. Port the toon materials to TSL node materials.
2. Verify them **under WebGL2** via `WebGLRenderer.setNodesHandler()` — this
   de-risks the material rewrite before any renderer swap.
3. Match all seven baseline screenshots and the full gameplay suite.
4. Re-implement `WindowPortal` against WebGPU render targets.
5. Only then enable the backend behind `?webgpu=1`, with clean fallback.

**Revisit when** a measured performance ceiling appears that WebGL2 cannot
clear, or when maintaining one backend rather than two becomes the simpler
option. Neither is true today.

---

## 9. Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Every existing interaction and visual scene still works | **Met** — counters identical; interior/sit/wardrobe/lie verified |
| 2 | All original and new tests pass | **Met** — 100/100, up from 85 |
| 3 | Typecheck, lint, production build clean | **Met** — `npm run verify` green |
| 4 | Playwright smoke in Chromium, Firefox, WebKit | **Not demonstrated** — written and wired, Chromium only so far |
| 5 | No unintended visual regression | **Partially met** — counters identical and scenes verified by eye; no automated pixel diff |
| 6 | Production build has no dev screenshot endpoint | **Met** — enforced by budget gate and smoke test |
| 7 | README corrected | **Met** |
| 8 | PHASE_01_REPORT.md | **Met** — this document |

**Two criteria are not fully met (4 and 5) and are stated as such rather than
rounded up.** Both need CI to run and a pixel-diff harness with tolerance.

---

## 10. Recommended next step

Run CI once and fix the first-run failures — particularly WebGL under
SwiftShader in headless Firefox and WebKit — before starting Phase 2. That
closes criterion 4 and gives Phase 2's "no monotonic memory rise across 20
transitions" a harness it can actually be measured with.
