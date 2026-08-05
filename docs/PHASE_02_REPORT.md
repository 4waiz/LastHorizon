# Phase 2 report — Zone streaming and engine boundaries

**Status: PARTIAL, deliberately.** The zone architecture, engine boundaries and
city geometry are built and tested. Physics, navigation, traffic lanes and the
debug overlay are **deferred to the phases that first need them**, recorded as
debt in the 2026-08-06 update at the foot of this document.

`Game.travelTo` is the one outstanding item that must land before a checkpoint
can honestly be tagged, because without it the city is unreachable.

This document says which is which. A report that rounds partial work up to
"done" is worse than no report — particularly when the next phase opens with
"continue from the clean checkpoint".

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

---

# Update — 2026-08-06

Sections 1–4 above were written partway through. This section supersedes them
where they disagree.

## Landed since

| Deliverable | State |
| --- | --- |
| `CityBuilder` — roads, sidewalks, crossings, four service shells, parking, streetlights, waterfront, skyline impostors | Built, unit-tested, **never seen in a browser** |
| `ZoneRuntime` contract | Built; `World implements` it |
| `Game` decoupled from `World` | 21 of 25 call sites go through the contract; 4 village-only members behind a narrowed type |
| `CityRuntime` | Implements the contract — flat ground from the street layout, collision rebuilt as chunks stream |

`npm run verify` green, **176 tests**.

## Deliberately deferred out of Phase 2

Recorded as debt rather than silently dropped. **None of these blocks Phase 3**,
which needs the life clock, aging, modes and saves — not physics or navigation.

| Deferred | Why it is safe to defer | Where it attaches |
| --- | --- | --- |
| `PhysicsWorld` + Rapier | No vehicles or dynamic bodies exist until Phase 5. Rapier 0.19.3 is installed and smoke-tested (ball rests at y=0.999). | `CollisionWorld`'s proxy geometry feeds both the BVH and a future Rapier static set |
| Recast tiled navmesh | No NPCs until Phase 6. Blocked on generator config — `generateSoloNavMesh` returns "Failed to create Detour navmesh data"; the call matches the package's own `.d.ts`, so it is config, not API misuse. | Per zone/chunk, alongside `ChunkStreamer` |
| Road lane graph runtime | No traffic until Phase 6. Lane data and dangling-edge validation already exist in the manifest. | `CityRuntime.mapData` already reads the graph |
| World debug overlay | Diagnostic only. `ZoneManager.debugState()` already returns zone, resident chunks and tracked resources — nothing renders it. | HUD |
| Playwright travel tests + heap snapshots | Needs `travelTo` first. The 20-round-trip assertion exists as a unit test at the object-ownership level. | `tests/e2e/` |
| City geometry visual verification | Needs `travelTo` first. | — |

## The one thing that must land before the checkpoint

**`Game.travelTo(zoneId)`.** Without it the city is unreachable, so acceptance
criterion 2 is false and the phase has no honest checkpoint.

Scoped, with steps 1–3 already done and green:

1. `await zones.travel.travel({ to, context })`.
2. On success: swap `this.runtime`, clear `this.village`, rebind
   `player.setSpawn`, `camera.resetBehind`, the minimap, and the audio zone
   profile from `zone.audio`.
3. On failure the player has not moved — `TravelService` already guarantees
   this by preparing the destination before releasing the source.
4. Expose it on `TestSurface` so `__LH_TEST__` can drive
   village → city → village.

Then tag **`phase-02-partial`** and begin Phase 3.

Two traps found the hard way, worth carrying:

- **Stale input walks the player out of frame during capture.** Call
  `input.releaseAll()` before `teleport`; it belongs inside
  `__LH_TEST__.prepareShot()`.
- **`CityRuntime` has no interactables and no interior cell.** Any `Game` code
  reached while a district is active must tolerate `this.village` being unset —
  that narrowing is the whole point of the split, and it will surface the
  moment travel works.

## Known defect carried forward

Window and door frames on `house_small`, `house_large` and `porch_house` stand
~6 cm proud of the wall, and the sill is 4 cm wider than its frame so it
overhangs unsupported. **Three attempts to fix this by repositioning offsets
failed and were reverted** (`9950a39`); the geometry is back to its original
state.

The reason: **there is no opening cut in those walls.** The wall body is a
solid box — `house_open()` and `room_interior()` use `boolean_diff` to cut real
holes, but the other three do not, so the frame assembly must sit proud to be
visible at all. Recessing it buries it inside solid geometry.

The real fix is to cut openings with `boolean_diff` before `join_objects` and
set the frames into them; design is in the session log. A cheap partial win
that needs no wall surgery: narrow the sill from `w + 0.20` to `w + 0.16` so it
stops overhanging.
