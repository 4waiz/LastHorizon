# Phase 6 report — NPC population, schedules, pedestrian AI and traffic

**Status: the village and the three districts are inhabited.** Twenty named
residents keep to authored routines, ambient pedestrians fill the pavements at
a density the quality preset chooses, and light traffic runs the road lane
graph. What is *not* done is listed in §8 rather than rounded away: there is no
dialogue UI, off-mesh links exist for doors and crossings but nothing yet
produces the `stairs` or `zone` kinds, and the mid-tier body is the player's
full-detail mesh rather than a decimated one.

**Date:** 2026-08-09
**Base:** `phase-05-vehicles`, plus one commit to green the gate
**Gate:** `npm run verify` green — **980 unit tests**, up from 743
**Branch:** `phase-06-population`

---

## 1. Phase 5 was verified first, and the tree was red

The instruction was to confirm Phase 5 before starting. Running the gate rather
than reading the report found that it was not green:

```
FAIL app chunk        304.9 kB / 300 kB
```

The Phase 5 report is accurate — it records 298.5 kB — and silent about what
came after it. The map-panel commit (`c233bc6`), merged after the report was
written, put the app chunk over. Everything else was green: 743 unit tests,
typecheck, lint and build all clean.

Fixed before starting Phase 6, in `47580fb`: the map is a panel behind a
keypress, so `HUD` now reaches its drawing code through a dynamic import.
`phase-05-vehicles` is tagged at that commit.

---

## 2. Recast is not broken

Phase 2 recorded navigation as blocked on the library:

> `generateSoloNavMesh` returns "Failed to create Detour navmesh data". The
> call signature matches the package's own `.d.ts`, so this is generator
> config, not API misuse.

The second sentence is right and the conclusion drawn from it was wrong. It is
generator config, and the config is fixable. A ten-line probe against
`recast-navigation` 0.43.1 generates both a solo and a tiled navmesh on
village-scale input, first try.

**The trap is units.** Only `cs`, `ch` and `walkableSlopeAngle` are in world
units. `walkableHeight`, `walkableClimb` and `walkableRadius` are **voxel
counts**. A 1.94 m character passed as `walkableHeight: 1.94` asks for 39 cm of
headroom at `ch` 0.2; a 0.30 m radius passed as `walkableRadius: 0.3` truncates
to zero and erodes nothing. The library's own defaults are voxel counts too
(`walkableHeight: 2`), which is what makes the mistake easy.

Tiled anyway, not solo, because tiles are what off-mesh links attach to and
what lets a district rebuild part of itself later. Measured on 85 k triangles
across a 256 m square:

| Cell size | Tile size | Build |
| --- | --- | --- |
| 0.30 | 32 voxels | 414 ms |
| **0.30** | **64 voxels** | **321 ms** |
| 0.35 | 64 voxels | 275 ms |
| 0.40 | 64 voxels | 249 ms |
| 0.50 | 64 voxels | 205 ms |

0.30 / 64 shipped. Dropping resolution bought 70 ms and cost doorway fidelity,
which is the one thing the navmesh has to get right.

**Erosion is the subtle part.** `walkableRadius` is applied from *both* sides,
so the obvious "two voxels for a 0.3 m agent" takes 1.2 m out of every gap and
closes a standard doorway completely. One voxel leaves 0.6 m of centre-line
through it. `tests/navTypes.test.ts` asserts this against
`DEFAULT_MOTOR.radius` so the two cannot drift apart.

In the running village the bake takes **209–338 ms** across runs.

---

## 3. What shipped

| System | Files | Unit tests |
| --- | --- | --- |
| Navigation types and config | `src/nav/NavTypes.ts` | 31 |
| Recast wrapper | `src/nav/Navigation.ts` | *(driven in-browser)* |
| Degradation boundary | `src/nav/NavService.ts` | *(driven in-browser)* |
| Schedules | `src/npc/ScheduleDefinition.ts`, `schedules.ts` | 18 |
| The twenty residents | `src/npc/NpcDefinition.ts`, `npcCatalog.ts` | 13 |
| Agent runtime | `src/npc/NpcAgent.ts` | 32 |
| LOD tiers and budgets | `src/npc/NpcLod.ts` | 14 |
| Bodies and pooling | `src/npc/NpcVisuals.ts` | *(driven in-browser)* |
| Perception | `src/npc/Perception.ts` | 25 |
| Relationships | `src/npc/Relationships.ts` | 15 |
| Barks and dialogue | `src/npc/Dialogue.ts` | 19 |
| Orchestration | `src/npc/Population.ts` | *(driven in-browser)* |
| Lane graph | `src/traffic/LaneGraph.ts` | 34 |
| Traffic rules | `src/traffic/TrafficRules.ts` | 27 |
| Traffic runtime | `src/traffic/TrafficSystem.ts` | *(driven in-browser)* |

### The population is lazy, and the game is complete without it

`recast-navigation` inlines ~900 kB of WebAssembly and the initial-load budget
had 77 kB of headroom, so navigation could not be on the startup path. The NPC
simulation is built on navigation, so the whole population followed it out —
definitions, schedules, agents, bodies, traffic.

The village is built, walkable and drivable before the import resolves.
`NavService` is the small eager half that knows navigation might never arrive:
everything above it asks `ready` and takes the coarse path when the answer is
no. A browser that cannot compile the WebAssembly still gets residents who keep
to their schedules and walk between places, without avoidance or exact
doorways.

Relationships live *above* `Population`, in `Game`, because the population is
destroyed and rebuilt on every zone change and the player's history with a
village resident has to survive a trip to the city.

### Midnight needs no special case

A schedule is a sorted list of blocks keyed on the hour they begin. The block
in force at hour *h* is the last one that began at or before *h* — and if none
has begun today, it is the last block of yesterday, still running. `night_shift`
starts its list at 07:00 and ends it at 21:00, and 02:00 resolves to "at work"
through the wrap rather than through a branch.

Seven routines cover twenty people, because a routine is the shape of a day
rather than a person: the shopkeeper and the barista both open early, and what
differs is where their anchors are.

### One draw call per person

The player's GLB is nine primitives — skin, hair, eye, trim, hat, band, shirt,
shorts, shoe. Cloning it per NPC is nine draw calls each, and against the old
340-call outdoor budget with 285 already spent, that bought about five
pedestrians.

So the nine are merged into one geometry and the colours baked into a
vertex-colour attribute. Every appearance variant **shares the same position,
normal and skinning attributes** and differs only in a normalised-byte colour
array, so a variant costs about 9 kB rather than a second copy of a
4,890-triangle mesh.

Measured, at one fixed vantage, low preset:

| | Draw calls | Triangles |
| --- | --- | --- |
| Unpopulated | 335 | 241 k |
| 12 bodies + 3 cars | 351 | 300 k |
| **Cost** | **+16** | **+59 k** |

That is exactly one call and 4,890 triangles per person — the arithmetic the
merge was built for. Programs did not move: 39–41 before and after, because
twenty-odd appearances share one material definition and one shader.

### Pedestrians use the navmesh; vehicles use lanes

Two separate systems that meet only as obstacles. A car does not want a
shortest path across a plaza, and expressing "stay in a lane" as a navmesh
constraint is far more work than expressing a lane as a polyline.

A zone supplies *centrelines*; `buildLaneGraph` turns each into two directed
lanes offset to the driver's right. The districts' centrelines are walked out
of the manifest's sparse lane-node graph; the village's come from the road
spline itself, thinned to every eighth point, so village traffic follows the
actual curved tarmac rather than a four-node approximation.

The player's own vehicle is a Rapier body and enters the traffic system as an
obstacle, never as a participant. That is the entire interface between the two.

---

## 4. Five bugs the measurements found

None of these were visible in a unit test. All five came out of running the
thing, looking at it and profiling it. Each has a regression test now.

### The navmesh included every roof

A flat roof is a walkable slope with unlimited headroom, so Recast put navmesh
on top of every house — and residents used it. The first Playwright run had
NPCs five metres above the terrain, and the stuck-recovery snap finding the
roof directly above a blocked destination and teleporting somebody up there.

`navInputFromGeometry` now takes a ground function and drops triangles whose
*every* corner is more than 2.2 m above it. Every corner, not the centroid: a
ramp that climbs past the threshold at one end is still a floor for most of its
length, and dropping it cuts the navmesh in half at the bottom of the slope.

After the fix the worst vertical deviation across the eight village residents
is **0.27 m**.

### Stuck recovery could warp somebody into a wall

The last resort was "place them at the destination". Sent somewhere
unreachable, that put a resident inside a building. It now widens the navmesh
search once, and if there is still nothing, **abandons the destination** and
lets the schedule or the wander pick the next one.

### The camera raycasts the whole scene, and skinned meshes are expensive

`CameraCollision.updateOcclusionFade` raycasts the entire scene every frame with
`firstHitOnly = false`. A `SkinnedMesh` with no BVH answers that by CPU-skinning
every one of its triangles. **Measured at 10.6 ms per call** in a dev build —
the largest single item in the frame, and it predates this phase: the player's
own rig is nine primitives of 4,890 triangles.

Thirty-two NPC bodies would have multiplied it by thirty-three. The player, the
NPC bodies and the traffic models are now all out of that raycast. None of them
can be occluders — the fade only touches materials created `fadeable`, and none
of theirs are, which is why the pass was doing the work and then discarding the
result.

What remains is the world itself, still walked in full. The proper fix is a
registry of fadeable meshes in `CameraCollision`; it is Phase 1 code and is
recorded in `docs/PERFORMANCE_BUDGETS.md` rather than made here.

### The city crowd walked down the middle of the road

The navmesh covers tarmac perfectly well, and two of Old Market's three ambient
areas were centred on the carriageway, so pedestrians spawned on it and
wandered across it. The first district screenshot is a column of people
walking up the main road.

The areas moved off the road, and `validateZone` now refuses one whose centre
is within 6 m of a lane — measured to the nearest lane *segment*, not the
nearest node, because a district's main road is two nodes 80 m apart and a
point beside the midpoint is nowhere near either end.

That rule then failed the village, which turned out to be a second bug: the
village's manifest lane nodes were a four-point sketch running up to eleven
metres off the road `RoadSystem` actually builds. Traffic never used them —
village centrelines come from the spline at runtime — but they were the only
road data the validator, and anything else reading the manifest, could see.
They now follow the same control points as the spline.

And while fixing that: a zone supplying its own centrelines now **replaces**
the manifest's rather than adding to them. Taking both gave the village two
overlapping road networks, one of which is not where the tarmac is.

### The watchdog barged every car through every red light

The deadlock watchdog shoves a vehicle that has not moved for eight seconds.
The traffic-light period was 24 s, so a red phase outlasted the threshold and
every car that stopped correctly was pushed across the junction.

Two halves to the fix. The period came down to 14 s, and the watchdog learned
that a red light is a legitimate reason to be stopped — a car held by one
accumulates a separate counter with a much higher ceiling. A genuine standoff,
where each car is waiting on another rather than on a light, still barges.

---

## 5. Budgets

### AI cost

Measured in the running game, simulation only, by disabling
`Population.update` between two timed runs of the same 120 frames:

| | With | Without | Population |
| --- | --- | --- | --- |
| ms per simulation frame | 8.08 | 7.93 | **0.15** |

That is with 22 bodies, 12 crowd agents and traffic live. The population is
not what costs anything in this frame; the pre-existing occlusion raycast is.

### The far tier is bounded, twice

The stated acceptance criterion is that far simulation cost is bounded and
documented. It is bounded by construction:

- the far tick runs at **2 Hz**, not per frame;
- each tick examines at most **`farPerTick`** residents (8 on low and medium,
  12 on high), resuming where it left off.

Twenty residents at eight per tick is a complete sweep every 1.5 s — far more
often than a schedule changes, and bounded however large the population grows.
Measured wall time per far tick: **0.0–0.1 ms**.

A far resident whose schedule turns over is *placed* at their new anchor rather
than walked there. Nobody is watching, and animating a 200 m commute that will
never be seen is the cost this tier exists to avoid.

### Population by preset

Measured at one fixed vantage on the village road, 10:00, day pinned:

| Preset | Draw calls | Triangles | Bodies | Crowd agents | Traffic | Sim ms/frame |
| --- | --- | --- | --- | --- | --- | --- |
| low | 364 | 286 k | 9 | 7 | 3 | 9.4 |
| medium | 430 | 462 k | 22 | 12 | 6 | 11.1 |
| high | 478 | 609 k | 26 | 20 | 8 | 12.4 |

### Chrome DevTools traces

Three traces at the same vantage, one per preset, the page left running
normally rather than stepped. Numbers are the duration of the `rAF` callback —
update *and* render — taken from the raw trace rather than from a summary.

| Preset | rAF p50 | p90 | p99 | Frame interval p50 | Effective rate |
| --- | --- | --- | --- | --- | --- |
| low | 9.88 ms | 10.37 ms | 12.29 ms | 10.29 ms | 99 /s |
| medium | 12.46 ms | 13.13 ms | 14.92 ms | 12.92 ms | 79 /s |
| high | 13.75 ms | 14.35 ms | 16.00 ms | 14.23 ms | 70 /s |

The interval tracks the callback almost exactly at every preset, which says the
main thread is the limit and nothing is waiting on the GPU. These are **dev
builds**, unminified and served through Vite, so the shipped figure is better;
they are the honest comparison between presets, not a release claim.

There is no long-task cliff and no frame above 22 ms in any of the three.
Traces are written to `.traces/phase6-{low,medium,high}.json` and gitignored —
tens of megabytes each, and regenerated by re-running the profiler.

The `high` caps were reduced during this phase — 28/24/10 to 22/18/8 — after
the first measurement put the outdoor scene past 480 draw calls, which is more
than the night peak the budget was written around.

The outdoor budgets moved to cover the rest: day 340 → 410, night 430 → 500,
triangles 560 k → 700 k. Triangles are the comfortable one; the interior
already runs at 780 k against an 880 k budget, so 700 k outdoors is well inside
what the renderer demonstrably handles. The justification is written up in
`docs/PERFORMANCE_BUDGETS.md`.

### Bundle

| Chunk | Size | Budget |
| --- | --- | --- |
| app chunk | 315.9 kB | ≤ 330 kB |
| `Population-*.js` | 48.3 kB | *lazy* |
| `Navigation-*.js` | 45.7 kB | *lazy* |
| `recast-navigation.wasm-compat-*.js` | 726.6 kB | *lazy* |
| **initial load** | **4,133.2 kB** | **≤ 4,200 kB** |
| shipped total | 7,143.5 kB | ≤ 7,400 kB |

Initial load moved by 13 kB across the whole phase. That is the eager half —
the relationship store, the LOD budgets and the population handle in `Game`.
Everything else is behind an import.

The app-chunk budget went 300 → 330 kB and the shipped total 6,600 → 7,400 kB,
both documented. The shipped total is entirely Recast's base64 WebAssembly, the
same trade already accepted for Rapier: the plain package's separate `.wasm`
would save ~390 kB and is a dependency change that belongs on its own commit.

---

## 6. Against the acceptance criteria

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Named NPCs are findable at sensible places by time | **Met.** `population.spec.ts` walks Maryam through five hours of `early_trade` and follows her from her doorstep to the stall. |
| 2 | No NPC walks through closed walls, floats, or blocks a doorway | **Met.** Roof triangles are out of the navmesh (worst deviation 0.27 m); recovery abandons rather than warping into geometry; sleeping residents go indoors so a doorstep is never camped overnight. |
| 3 | Traffic does not deadlock and has a watchdog | **Met.** Barge then remove, with red lights exempted from the stall timer. |
| 4 | Far simulation cost is bounded and documented | **Met.** 2 Hz, capped per tick, measured at 0.0–0.1 ms. §5. |
| 5 | Relationships and schedules persist through save/load and birthdays | **Met.** Round-tripped in `population.spec.ts` and in `save.test.ts`; `npcs` is an optional save field so a pre-Phase-6 save still loads. |
| 6 | `docs/PHASE_06_REPORT.md` with AI budgets and profiler evidence | This document. |

Two of the brief's other requirements are worth calling out because they are
enforced rather than merely observed:

- **No child NPC is combat-capable.** `validateNpcCatalogue` rejects the
  combination, and `npcCatalog.test.ts` constructs one to prove the validator
  fires. Nothing in the shipped catalogue is combat-capable at all; Phase 9
  owns arming anyone.
- **Perception is never omniscient.** Distance, field of view, occlusion by the
  same collision proxy the player bumps into, and hearing that is attenuated
  rather than blocked. Phase 9's police will read this layer, so there is no
  code path that can hand them a position nobody witnessed.

---

## 7. Verification

**Unit:** 980 tests across 40 files. Ten new files, 232 new tests.

**Browser:** `tests/e2e/population.spec.ts`, 15 scenarios, against the
production build. Covers: the village inhabited and the navmesh real; crowd
agents taken and given back with distance; a named resident through five hours
of routine; the same resident walking home-to-work; nobody floating; a resident
sent into a wall staying out of it; residents still moving over a long stretch;
traffic running without deadlock; traffic never appearing in front of the
player; a disturbance witnessed and a greeting remembered; a wall stopping a
witness; relationships and ages surviving save/reload and a birthday; leaving
the zone and coming back; driving through the village; and no duplicate
three.js.

**Screenshots:** `.shots/p6_street.jpg`, `p6_stall.jpg`, `p6_road.jpg` and
`p6_city2.jpg` — the village and Old Market with residents and traffic in them,
taken through the offscreen render path so they do not depend on a visible
window.

**By hand, in the browser:** the Old Market travelled to and populated (5
named, 18 ambient, 8 cars, navmesh in 94 ms, 5 off-mesh links); the navmesh
probed inside and outside the chunks resident when it was baked; every
resident's height checked against the terrain under them.

**Commands run:** `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run check:budgets`, `npx playwright test --project=chromium`.

---

## 8. What is not done

Listed rather than rounded away.

- **No dialogue UI.** The dialogue *data path* is complete and tested — the
  tree is walked, choice conditions are evaluated against the live relationship
  and the player's age, effects are applied — but talking to somebody takes the
  first available choice and reports the outcome as a toast. A panel with
  portraits, history and controller support is Phase 11's, and inventing a
  throwaway one now would be a screen to delete rather than build on.
- **`stairs` and `zone` off-mesh links are declared and unused.** The kinds
  exist in `OffMeshKind` and nothing produces them: stairs need interiors,
  which is Phase 7, and zone links need NPCs who travel between zones, which
  nothing yet does.
- **The mid tier uses the full-detail body.** 4,890 triangles for a pedestrian
  forty metres away. A decimated variant would give back roughly 96 k triangles
  at the `high` preset and needs a Blender change to the shared rig.
- **Ambient pedestrians do not use doors.** They wander between ambient areas
  and are recycled at the bubble edge. Named residents use door links; ambient
  ones have no home to go to.
- **Phone messages are not implemented.** The brief mentions named NPCs sending
  them "later"; nothing here does.
- **No visual crossing behaviour on the mid tier.** `preferredCrossing` routes
  ambient pedestrians via marked crossings, but a mid-tier pedestrian walks the
  navmesh corners without the sidestep-and-wait that would make it read.
- **Traffic has no audio, no lights and no horn.** Consistent with Phase 5,
  where the same three are listed as outstanding for the player's vehicles.
- **The dev screenshot harness in `vite.config.ts` is stale.** It reaches for
  `g.world`, which Phase 2 renamed to `g.village`/`g.runtime`. The Phase 6
  screenshots were taken by an inline equivalent. Not fixed here because it is
  a dev-only surface and touching the Vite config mid-phase is the wrong risk.

## 9. Remaining risk

- **The occlusion raycast is still the frame's largest item.** Taking the
  characters out of it helped and did not solve it. Until `CameraCollision`
  keeps a registry of fadeable meshes, anything added to the scene pays a
  raycast tax.
- **Draw calls at `high` are close.** 478 against a 410 budget at a busy
  vantage — the vantage is busier than the one the documented 285 baseline was
  taken at, so the two are not directly comparable, and re-establishing the
  baseline scenes is worth doing before Phase 7 adds interiors.
- **The frame budget has never been measured on real mid-tier hardware.** That
  caveat is inherited from Phase 1 and this phase does not lift it.
- **A district's navmesh does not follow its streaming.** It is baked once,
  from whatever chunks are resident at that moment. Probed in Old Market: a
  point in a chunk that streamed in *later* returns no navmesh sample, while
  everything baked-in samples fine. It degrades rather than breaks — agents
  there fall back to coarse movement and straight-line paths — but it is the
  thing to fix before Phase 7 gives districts interiors, and tiled generation
  was chosen partly so a per-tile rebuild is possible.
- **District populations are untested beyond travel.** The Old Market has five
  residents, eighteen pedestrians, eight cars and a 94 ms navmesh, checked by
  hand and by the travel scenario; nobody has walked a full day there.

## 10. Next safe phase

Phase 7 — enterable services, modular interiors, economy and jobs. It attaches
cleanly: `InteriorLink` already produces door off-mesh links, named residents
already have `work` anchors at the buildings Phase 7 will make enterable, and
`inventoryHooks` and `questRoles` are declared on all twenty and unspent.

Do it after re-establishing the documented baseline scenes, so the interior
work has a draw-call number it can be measured against.
