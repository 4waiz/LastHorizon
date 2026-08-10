# Architecture v2

The shape of the codebase after Phase 1, and the seams that later phases plug
into. For the current game's design notes, see the README.

---

## Layers today

```
main.ts                     boot, WebGL capability check, flag resolution
  core/
    FeatureFlags.ts         typed flags from the query string, default off
    TestMode.ts             the ?e2e=1 window.__LH_TEST__ bridge
    RendererBackend.ts      renderer seam + factory (WebGL2 today)
    Renderer.ts             WebGL2 backend
    Game.ts                 frame loop; owns and orders every subsystem
    AssetManager.ts         loads the five GLB packs
    InputManager.ts         keyboard / mouse / wheel / virtual stick
    AudioManager.ts         synthesis + two streamed music beds
    Settings.ts             quality presets, device detection, persistence
  world/                    Terrain, RoadSystem, Environment, Sky, Vegetation,
                            Birds, Collectibles, Interiors, World
  player/                   Player, PlayerController, PlayerStateMachine,
                            PlayerAnimator
  camera/                   ThirdPersonCamera, CameraCollision
  physics/                  CollisionWorld (one merged static BVH),
                            CharacterMotor
  graphics/                 ToonMaterial, StylizedShadows, PostProcessing,
                            WindowPortal
  ui/                       HUD, Minimap, LoadingScreen
```

## Seams added in Phase 1

### RendererBackend

`Game` no longer constructs a renderer directly; it calls
`createRendererBackend()`. `Renderer` implements `RendererBackend` and
declares `kind = 'webgl2'`.

WebGL2 is the release default and the only implementation. The toon look is
built from `onBeforeCompile` patches, which `WebGPURenderer` does not run, so
a backend swap is a reimplementation in TSL rather than a port. `?webgpu=1`
exercises the fallback path today. See `docs/adr/0001-renderer-backend.md`.

### FeatureFlags

Typed, resolved once from the query string, default off, never read from
storage. A flag must be asked for in the URL every time, so a stale toggle
cannot persist into ordinary play.

### TestMode

`window.__LH_TEST__` installs only under `?e2e=1`, via dynamic import so it
stays out of the main chunk. It talks to a narrow `TestSurface` built by
`Game` — a fixed set of typed operations, not a scene-graph handle.

`Game.testSurface()` is the single place where private internals are exposed,
deliberately, in one reviewable block.

## Invariants worth protecting

**One material factory.** Everything routes through `makeToon()`, sharing a
single 3-band ramp so the scene bands identically. `customProgramCacheKey`
collapses ~99 imported materials onto ~23 programs. Per-object materials
fragment batching immediately.

**Palette names are colours, not semantics.** `leaf_mid` and `leaf_teal` paint
book spines, blankets and pens as well as foliage. Wind, occluder fade and
double-siding are now opt-in and granted only on the vegetation path.

**One collision BVH.** `CollisionWorld` merges purpose-built proxy meshes, not
render meshes. Later phases must generate physics colliders from *the same*
proxy geometry, not from visual meshes.

**Interiors are a separate cell** 600 m above the terrain, because the ~2 m
heightfield is too coarse to hold a house-sized platform flat. Return position
and facing are preserved across the transition.

**The interior is the performance worst case** — `WindowPortal` re-renders the
outdoor world, taking triangles from ~482 k to ~780 k.

## Where later phases attach

| Phase | Attaches to |
| --- | --- |
| Zone streaming | `World` becomes one zone behind a `ZoneManager`; `Game` keeps owning the frame loop |
| Physics | `CollisionWorld`'s proxy geometry feeds both the BVH and a future Rapier static set; the BVH motor stays default until a parity suite passes |
| Fixed-step clock | `Game.update(dt)` is already the single simulation entry point; `TestSurface.step()` drives it deterministically |
| Save system | `Settings` and `Collectibles` already own persistence; both need migrating behind a versioned service |
| Disposal | `DisposeUtils` plus each subsystem's `dispose()` — ownership must become explicit per zone |

## The population, added in Phase 6

```
Game
 ├── RelationshipStore            eager, small, outlives every zone
 └── Population            (lazy) ─── import('../npc/Population')
      ├── NavService              the only thing that knows nav might be absent
      │    └── Navigation  (lazy) ─── import('./Navigation') -> recast-navigation
      ├── NpcAgent  x N           named and ambient, one class
      ├── NpcVisuals              one merged body geometry, per-appearance colours
      ├── PerceptionBus           one frame of events, resolved against observers
      └── TrafficSystem
           └── LaneGraph          centrelines -> two directed lanes each
```

Three boundaries are load-bearing.

**`Population` is lazy, and the game is complete without it.** It carries
Recast's ~900 kB of WebAssembly, and the initial-load budget had 77 kB of
headroom. The village is built, walkable and drivable before the import
resolves; residents arrive behind it. Nothing in `Game`'s frame path may assume
`this.population` exists.

**`NavService` is the degradation boundary.** It is eager and tiny; the recast
half behind it is not. Everything above asks `ready` and takes the coarse path
when the answer is no, so a browser that cannot compile the WebAssembly gets a
village where people still keep to their schedules — just without avoidance or
exact doorways.

**`RelationshipStore` lives above `Population`, not inside it.** The population
is destroyed and rebuilt on every zone change; the player's history with a
village resident has to survive a trip to the city. Named-resident ages are
lifted out for the same reason, in `disposePopulation`.

Pedestrians use the navmesh and vehicles use the lane graph, and the two never
meet except as obstacles. A car does not want a shortest path across a plaza,
and expressing "stay in a lane" as a navmesh constraint is far more work than
expressing a lane as a polyline.

## The story, added in Phase 8

```
Game
 ├── StoryState                  eager, small, in every save
 └── StorySubsystem      (lazy) ─── import('../story/StorySubsystem')
      ├── StoryDirector          the only thing that drives the story
      │    ├── QuestSystem       stages, branches, rewards, fail/retry
      │    ├── DialogueRunner    where you are in a conversation
      │    └── CutscenePlayer    camera paths over the world as it stands
      ├── storyCatalog           35 quests, 7 chapters
      ├── dialogueCatalog        15 trees, widening Phase 6's types
      ├── Endings                3 families, 13 variants
      ├── LifeReel               model + canvas renderer + local export
      ├── strings                ~460 keys; the only place a sentence lives
      └── StoryPanels            dialogue, journal and reel DOM
```

Four boundaries are load-bearing.

**`StoryState` is above `StorySubsystem`, not inside it.** The save layer reads
and writes story progress whether or not a quest has ever loaded, exactly as
`RelationshipStore` sits above `Population` because a village friendship has to
survive a trip to the city. It is a bag of flags, choices, two reputation
numbers, an append-only reel and a map of quest positions — no catalogue, no
Three.js, no clock.

**`StoryDirector` is the only thing that mutates story state.** Nothing else
applies a consequence, pays a reward or moves a stage. That is what makes "no
quest logic hidden in UI components" checkable rather than aspirational: a
panel can only *ask*, and there is one place to look when it does the wrong
thing. `StoryPanels` takes strings and a callback and has never heard of a
stage.

**`QuestSystem` reads no clock and touches no DOM**, like `TaskSystem` before
it. Seconds arrive through `advance(dt)` and everything else through a host, so
seven chapters are walked start to finish in a millisecond by
`storyContent.test.ts` — on both the legal and the criminal route, on every
commit.

**Text is a key, never a string.** `strings.ts` is the only file with a
sentence in it, and `t()` falls back to its key, so a missing entry renders as
`obj.q4_city_job.desk` — visibly wrong rather than invisibly blank. It is also
what lets "is anything missing a translation?" be a question `check:story`
answers.

### Where the quest system attaches to what already existed

| Phase | It uses |
| --- | --- |
| 3 | `Gates.canEnterZone` and `village_departure`, unchanged — chapter 4 is what finally *sets* the chapter id the city has been gated on since |
| 4 | `Inventory` for `collect`, the three upper-body clips for cutscene staging |
| 5 | The live vehicle body for `drive` metres; `park` is a distance check |
| 6 | Twenty residents whose `questRoles` were declared before a quest system existed; the five relationship axes; `validateDialogue` |
| 7 | `TaskSystem` runs for `work_shift`, `Economy.award` for money, interior points for `interact` |

Nothing in phases 1–7 changed shape to accommodate it, which is the test of
whether the seams were in the right places.

## Known architectural debt

- **No disposal ownership model.** Subsystems have `dispose()`, but nothing
  enforces who owns what. Zone streaming will require this.
- **The frame loop is not fixed-step.** `Game.update(dt)` takes a variable dt
  clamped to 1/15 s. A fixed-step clock with render interpolation is Phase 2
  work.
- **Interiors are one shared room** reached by all eight doors.
- **Vite is pinned to 7** because Rolldown's native binding is blocked by this
  machine's Smart App Control. See `docs/adr/0002-vite-7-not-8.md`.
