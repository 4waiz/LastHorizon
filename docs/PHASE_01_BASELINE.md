# Phase 1 — Measured baseline (pre-migration)

Recorded before any dependency or source change, on the commit at `dc97fed`
plus two uncommitted working-tree edits (`index.html`, `dist/index.html`:
the interact hint text). Every number here was measured, not estimated.

**Host:** Windows 11 (10.0.26200), Node v24.16.0, npm 11.13.0.
**Browser:** Chromium via Playwright MCP, DPR 1.5, canvas 1554×1273.

---

## Installed package versions (exact, from `npm ls --depth=0`)

| Package | Installed | Latest on npm (2026-08-05) |
| --- | --- | --- |
| three | 0.169.0 | 0.185.1 |
| @types/three | 0.169.0 | 0.185.4 |
| three-mesh-bvh | 0.8.3 | 0.9.14 |
| gsap | 3.15.0 | 3.15.0 (current) |
| typescript | 5.9.3 | 7.0.2 (see note) |
| vite | 5.4.21 | 8.2.0 |
| vitest | 2.1.9 | 4.1.10 |
| eslint | 8.57.1 | 10.8.0 |
| @typescript-eslint/eslint-plugin | 8.65.0 | 8.66.0 |
| @typescript-eslint/parser | 8.65.0 | 8.66.0 |
| jsdom | 25.0.1 | 30.0.1 |
| @types/node | 26.1.2 | 26.1.2 (current) |

### Note: TypeScript 6, not 7

`typescript@latest` is **7.0.2**, but `@typescript-eslint` 8.66.0 (the newest
release; there is no v9) declares:

```
peerDependencies: { "typescript": ">=4.8.4 <6.1.0" }
```

TypeScript 7 is therefore unsupported by the only available lint toolchain.
Adopting it would force either a broken `npm run lint` or a blanket disable —
both barred by the phase rules. **Target is TypeScript 6.0.3**, the newest
release inside the supported range. Revisit when typescript-eslint ships TS 7
support.

`vite@8.2.0` requires Node `^20.19.0 || >=22.12.0`; the host runs 24.16.0. OK.

---

## Command results

| Command | Result |
| --- | --- |
| `npm run typecheck` | **pass**, exit 0, no output |
| `npm run lint` | **pass**, exit 0, no output |
| `npm test` | **pass**, exit 0 — **85 tests in 6 files**, 2.15 s |
| `npm run build` | **pass**, exit 0 — 101 modules, 1.54 s (4.4 s incl. tsc) |

### Test counts per file

| File | Tests |
| --- | --- |
| `tests/mathUtils.test.ts` | 15 |
| `tests/world.test.ts` | 26 |
| `tests/settings.test.ts` | 13 |
| `tests/playerState.test.ts` | 11 |
| `tests/input.test.ts` | 11 |
| `tests/collectibles.test.ts` | 9 |
| **Total** | **85** |

The README claims 79. That is wrong — see "Documentation defects" below.

`npm test` emits one stderr line: `WARNING: Multiple instances of Three.js
being imported.` This is a known, documented artefact of Vitest's node
resolution and does not occur in the bundle.

---

## Bundle baseline (`npm run build`)

| Artefact | Raw | Gzip |
| --- | --- | --- |
| `dist/index.html` | 16.60 kB | 4.53 kB |
| `assets/index-*.css` | 15.47 kB | 4.26 kB |
| `assets/bvh-*.js` | 48.82 kB | 16.16 kB |
| `assets/gsap-*.js` | 70.44 kB | 27.81 kB |
| `assets/index-*.js` | 204.62 kB | 63.88 kB |
| `assets/three-*.js` | 573.51 kB | 145.44 kB |
| **JS total** | **897.39 kB** | **253.29 kB** |

## Asset baseline (`public/`)

| Asset | Size |
| --- | --- |
| `assets/audio/indoor.mp3` | 1103.7 kB |
| `assets/audio/outdoor.mp3` | 564.1 kB |
| `assets/models/buildings.glb` | 353.8 kB |
| `assets/models/player.glb` | 348.8 kB |
| `assets/models/nature.glb` | 112.1 kB |
| `assets/models/props.glb` | 100.0 kB |
| `assets/models/collectibles.glb` | 38.3 kB |
| `icon.png` | 237.4 kB |
| **GLB subtotal** | **953.0 kB** |
| **Audio subtotal** | **1667.8 kB** |
| **Total shipped assets** | **2858.2 kB** |

README claims "Total asset payload ≈ 850 KB of GLB". Actual GLB is 953 kB,
and the README omits 1.67 MB of audio entirely.

---

## Runtime baseline

Measured on the dev server (`npm run dev`, port 5199), High quality preset
auto-selected, day/night cycle running.

| Metric | Value |
| --- | --- |
| `domContentLoaded` | 511 ms |
| `load` | 517 ms |
| Average FPS (6 s sample, 362 frames) | **60.2** |
| Median frame | 16.7 ms |
| p95 frame | 16.8 ms |
| Worst frame | 17.2 ms |
| Draw calls — village day | 257–285 |
| Draw calls — village night | 377 |
| Draw calls — interior | 183 |
| Triangles — village | ~482–485 k |
| Triangles — interior | **~778–780 k** |
| Shader programs | 23 at start, 40 steady-state |
| Geometries / textures | 198 / 17 |
| JS heap at start | 23.3 MB |

Auto-selected preset: **High** — pixelRatio 2, shadowMap 4096, shadowRadius
72, vegetation 1.0, grass 1.0/48 m, 20 clouds, 28 birds, AA on, fog 560.

### Two measurements that contradict the README

- **Interior is the heaviest scene, not the lightest.** ~778 k triangles
  indoors vs ~482 k outdoors, because `WindowPortal` re-renders the outdoor
  world into a second target. Draw calls drop (183) but triangle load rises
  ~61%. Any future perf budget must treat the interior as the worst case.
- **Draw calls are ~257–285 at High, not ~450** as the README states.
  Night is the outdoor peak at 377 (the lamp point-light pool engaging).

### Memory soak

Sampled every 10 s with the day/night cycle running, player outdoors:

- Heap start 28.4 MB → 24.8 MB at 160 s; range 24.1–28.8 MB.
- **Net change negative** — GC reclaims freely, no monotonic rise.
- Geometries (198), textures (17) and programs (40) **exactly constant**
  across the whole run. No accumulation.

### Console

**0 errors.** 2 warnings, both emitted by Three's own program compile under
ANGLE/D3D:

```
THREE.WebGLProgram: Program Info Log: warning X3557: loop only executes for
1 iteration(s), forcing loop to unroll
```

These are HLSL translation notices from the shader compiler, not application
faults. Recorded so a post-migration change in this count is visible.

---

## Baseline screenshots

Captured with Playwright at 1036×849 CSS px, dev FPS overlay hidden, clock
frozen (`day` = 0.615, `night` = 0.03) so shots are comparable:

| # | File | Scene |
| --- | --- | --- |
| 1 | `01-intro.png` | Loading screen, settled, "Step outside" |
| 2 | `02-village-day.png` | Village at authored spawn, day |
| 3 | `03-village-night.png` | Same framing, night, lamps lit |
| 4 | `04-interior.png` | Interior cell at room spawn |
| 5 | `05-wardrobe.png` | Wardrobe panel open (backdrop-blur is by design) |
| 6 | `06-sitting.png` | Seated in the chair, "Stand up" prompt |
| 7 | `07-sleeping.png` | Lying on the bed, head on pillow |

Stored in `.playwright-mcp/baseline/` (gitignored). The sleeping shot is set
via the same state `sleep()` produces rather than by racing its 1500 ms hold,
so it is reproducible.

---

## Screenshot sink: verdict **keep**

`vite.config.ts` registers `lh-shot-sink` with `apply: 'serve'`, and the
`window.__lh` handle in `src/main.ts:40` is behind `import.meta.env.DEV`.
Grepping the built output for `__shot`, `__cap`, `lh-shot-sink`, `__view`,
`__free`, `__top` and `__lh` returns **no matches**. It is correctly gated and
absent from production, so the phase rule permits keeping it.

---

## Documentation defects found (README)

1. **"`npm test` — Vitest suite (79 tests)"** — actually **85**.
2. **"There are no audio files."** — false. `AudioManager` loads
   `./assets/audio/{zone}.mp3` (`src/core/AudioManager.ts:174`) into an
   `HTMLAudioElement` layer over the synth bed, falling back to synth-only if
   the file is missing (`:191`). 1.67 MB of MP3 ships.
3. **"Every asset is original … the entire soundtrack is synthesised in the
   browser … Nothing is downloaded, scraped or derived from any third-party
   source."** — cannot be true as written given the two MP3s. Their provenance
   is **unresolved** and blocks `docs/ASSET_LICENSES.md`.
4. **"~450 draw calls"** — measured 257–285 at High.
5. **"Total asset payload ≈ 850 KB of GLB"** — actually 953 kB, plus 1.67 MB
   of unmentioned audio.

## Repository hygiene findings

- **Duplicate assets at repo root.** `indoor.mp3` (1130161 B) and
  `outdoor.mp3` (577619 B) are byte-identical in size to the copies under
  `public/assets/audio/`. Only the `public/` copies are served. The root pair
  is 1.63 MB of dead weight.
- `icon.png` at root (725132 B) differs from `public/icon.png` (243069 B) —
  the root file appears to be the larger source image.
- `dist/` is committed and was stale relative to source before this rebuild.
- `scripts/blender/__pycache__/` is committed (2 `.pyc` files).
