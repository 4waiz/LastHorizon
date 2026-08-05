# Phase 2 report — Zone streaming and engine boundaries

**Status: INCOMPLETE.** Roughly a third of the phase is built, tested and
committed. The rest is not started. This document says which is which, because
a report that rounds partial work up to "done" is worse than no report.

**Date:** 2026-08-05
**Base:** tag `phase-01-foundation`
**Gate:** `npm run verify` green — **159 tests**, up from 100 at end of Phase 1.

---

## 1. What is built and verified

### Typed zone architecture (`src/world/zones/`)

| Module | Responsibility |
| --- | --- |
| `Manifest.ts` | `WorldManifest` / `ZoneManifest` / `ChunkManifest`, structural validation, deterministic chunk seeds, grid building |
| `ChunkStreamer.ts` | Load radius, hysteresis dead band, deterministic ordering, failure-safe lifecycle |
| `SpawnRegistry.ts` | Arrival resolution with graded fallback and vehicle safety |
| `TravelService.ts` | Zone travel with source-context preservation and no-op failure |
| `ZoneManager.ts` | One active zone, one disposal scope per zone, one per chunk |
| `worldManifest.ts` | The five declared zones |

**Zones declared:** `village_coast` (authored, unchanged, playable),
`city_old_market`, `city_downtown`, `city_waterfront` (streamed, playable),
`hill_airstrip` (declared, `playable: false`, reserved for Phase 10).

### Engine boundaries (`src/core/`)

- **`SimulationClock`** — fixed step with interpolation `alpha`, backlog
  clamping, pause/resume that discards rather than replays hidden time.
- **`DisposalRegistry`** — explicit ownership across geometry, materials,
  textures, render targets, audio, physics, navmesh and subscriptions.

### Design decisions worth recording

**Travel prepares before it releases.** The destination must resolve a valid
spawn *and* build successfully before the source zone is torn down. A failed
journey is therefore a no-op: the player has not moved and no state was
mutated. Asserted by a test that checks `released === []` after a failed
prepare.

**Hysteresis is tested as anti-thrash, not as a constant.** A player standing
on a chunk boundary sits exactly at the load-radius edge; without a dead band
that chunk loads and unloads on alternating frames. One test walks back and
forth across a boundary twelve times and asserts churn converges.

**The memory target is expressed as object ownership, not heap bytes.** Heap
size is noisy because GC timing varies — this was already observed in the
Phase 1 baseline, where heap *fell* over a soak. A test runs 20
village↔city round trips and asserts tracked resources and resident chunks
both return to exactly zero.

**Validation refuses to boot on a bad manifest.** The failure modes it catches
are the ones that strand a player: missing default spawn, out-of-bounds spawn,
one-way neighbour edge, dangling lane node, load radius over the two-ring
budget, streamed zone with no hysteresis.

### Defect found and fixed

`SimulationClock` initially dropped a step to floating-point drift:
`0.25 - 0.2 + 0.05 = 0.0999…`, so `floor(0.999…) = 0` and a step that was
arithmetically due was deferred a frame. Fixed with an epsilon before the
floor, with the accumulator clamped non-negative. Caught by a test written
before the fix.

### Dependencies

| Package | Version | State |
| --- | --- | --- |
| `@dimforge/rapier3d-compat` | 0.19.3 | **Installed and smoke-tested.** Ball dropped onto a cuboid rests at y = 0.999 (ground 0.5 + radius 0.5). Solver correct. |
| `recast-navigation` | 0.43.1 | **Installed, not working yet.** `generateSoloNavMesh` returns "Failed to create Detour navmesh data". The call signature matches the package's own `.d.ts`, so this is generator config, not API misuse. |

Both are WASM, so neither is affected by the Smart App Control problem that
blocked Rolldown in Phase 1 (see `adr/0002-vite-7-not-8.md`).

---

## 2. What is NOT built

Nothing below is started.

1. **`ZoneManager` is not wired into `Game`.** The village is described as a
   zone but is still constructed by the original `World` path. This is the
   keystone: until it is done, zones exist on paper only.
2. **City prototype geometry.** No blocks, roads, sidewalks, crossings,
   building shells, waterfront, parking, streetlights or skyline impostors.
   The city manifest describes chunks that nothing yet builds.
3. **`PhysicsWorld` interface, Rapier integration, BVH coexistence layer.**
   Rapier is installed and proven to run; it is not connected to anything, and
   no static colliders are generated from the proxy geometry.
4. **Recast tiled navmesh generation and serialization.** Blocked on the
   generator config above.
5. **Road lane graph runtime.** Lane nodes exist as manifest data with
   validation; there is no graph structure, no query, no visualisation.
6. **World debug overlay.** `ZoneManager.debugState()` returns the data
   (zone, resident chunks, tracked resources, travelling) but nothing renders
   it.
7. **Playwright zone-travel tests and heap snapshots.** No browser coverage of
   travel; the 20-transition assertion is a unit test, not a real heap
   measurement.
8. **Architecture diagram updates.**

---

## 3. Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Village visually and mechanically intact | **Met, trivially** — nothing is wired in, so the village is byte-identical. Not evidence the architecture preserves it. |
| 2 | City prototype reachable and explorable | **Not met** — no geometry exists |
| 3 | Collision, camera, grounding, doors, returns work in both zones | **Not met** — only one zone is real |
| 4 | Tiled navmesh visualizable and queryable | **Not met** — Recast not generating |
| 5 | Memory and object counts return to baseline | **Partially met** — proven at the ownership level by unit test; no heap snapshot |
| 6 | No transition can strand the player | **Met at the logic level** — spawn fallback and no-op failure are tested; untested in a real browser |
| 7 | `PHASE_02_REPORT.md` and updated diagrams | **Partially met** — this report exists; diagrams not updated |

**Two of seven met, two partial, three not met.**

---

## 4. Recommended next step

Wire `ZoneManager` into `Game` so `village_coast` becomes a real zone before
any city geometry is authored. That ordering matters: it converts criterion 1
from trivially true into meaningfully true, and it is the only way to find out
whether the disposal ownership model actually holds against the existing
`World`, `CollisionWorld` and `WindowPortal` — all of which currently own
resources that no registry knows about.

Building the city first would mean authoring geometry against an integration
that has never been exercised.
