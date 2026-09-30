# Architecture — 0.1.0

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

The shape of the codebase as shipped. [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md)
is the Phase 1 document and is kept as the record of where the seams were put;
this is what grew out of them.

---

## 1. The one-sentence version

A single-player browser game with **no server**: `Game` owns a frame loop,
everything expensive is behind a dynamic `import()`, and the save is plain JSON
on the player's own device.

## 2. Layers

```
main.ts                  boot, WebGL check, crash handler, service worker
  core/
    Game.ts              the frame loop; owns and orders every subsystem
    FeatureFlags.ts      typed flags from the query string, default off
    TestMode.ts          the ?e2e=1 bridge                        (lazy)
    Recovery.ts          the crash screen and its diagnostics
    ContextLoss.ts       WebGL context loss
    ServiceWorkerClient  registration, offline and update banners
    RendererBackend.ts   renderer seam + factory (WebGL2 today)
    Settings.ts          quality presets, accessibility, persistence
    clocks/              LifeClock, WorldClock, StoryClock
  world/                 Terrain, RoadSystem, Environment, Sky, Vegetation
    zones/               Manifest, ZoneManager, ChunkStreamer, TravelService
      CitySubsystem      district runtime + builder              (lazy)
    interiors/           InteriorSubsystem: 9 layouts, builder    (lazy)
  player/ camera/ physics/ graphics/ interaction/
  npc/                   Population, NavService, traffic          (lazy)
  story/                 StorySubsystem: quests, dialogue, reel   (lazy)
  combat/ crime/         CombatSubsystem: weapons, Heat, police   (lazy)
  flight/                FlightSubsystem: model, bounds           (lazy)
  economy/ tasks/ services/
  save/                  SaveService, SaveSchema, ImportGuard
  ui/                    HUD + five lazy panels
```

## 3. The one idea that shaped everything

**What does the save layer touch on the first frame?**

That question was first asked in Phase 7 and it decided every split since. It
produces a consistent shape: a small eager module holding the state a save
reads and writes, and a large lazy module holding everything that *acts* on it.

| Eager, and small | Lazy, and large |
| --- | --- |
| `StoryState` — flags, choices, reputation, reel | the 35 quests, 15 trees, 9 cutscenes, 13 endings |
| `CombatState` — two blobs, four HUD mirrors | weapons, ballistics, crimes, Heat, police AI |
| `RelationshipStore` — five axes per resident | the twenty residents, their schedules, the navmesh |
| `Economy`, `TaskSystem` — wallet, counters | the price catalogue, the six job definitions |
| `Wallet` — cash on the HUD from frame one | the nine interior layouts and the service layer |

The rule this produces is worth stating plainly: **a system's wiring cannot be
lazy, and its content almost always can.** Four consecutive phases cost the app
chunk about 15 kB each for exactly that reason.

## 4. What a player actually downloads

| | Size |
| --- | --- |
| **Initial load** — before you can play | **3,110.7 kB** |
| Fetched on demand | 4,598.6 kB |
| **Shipped total** | **7,714.1 kB** |

The lazy half, and when each arrives:

| | Size | Arrives when |
| --- | --- | --- |
| `rapier-*.js` | 2,184.9 kB | you first get on a bicycle |
| `recast-navigation` | 709.5 kB | the population loads, after the world |
| `indoor.mp3` | 1,103.7 kB | you first walk through a door |
| `StorySubsystem` | 106.1 kB | Story Mode starts |
| `interior_kit.glb` | 145.5 kB | you first walk through a door |
| `CombatSubsystem` + `weapons.glb` | 93.4 kB | a weapon is drawn |
| `aircraft.glb` + `FlightSubsystem` | 70.5 kB | you walk up to the aeroplane |
| `Population`, `CitySubsystem`, `taskCatalog`, panels | ~185 kB | as needed |

A player who spends an hour in the village on foot fetches almost none of it.

## 5. Three boundaries that carry weight

**`NavService` is the degradation boundary.** Eager and tiny; the ~900 kB of
Recast behind it is not. Everything above asks `ready` and takes the coarse
path when the answer is no, so a browser that cannot compile the WebAssembly
still gets residents who keep to their schedules — without avoidance or exact
doorways. Nothing in the frame path may assume `this.population` exists.

**`StoryDirector` is the only thing that mutates story state.** Nothing else
applies a consequence, pays a reward or moves a stage. That is what makes "no
quest logic hidden in UI components" checkable rather than aspirational: a
panel can only *ask*.

**`HeatSystem` has one belief field and exactly three writers** — an officer
saw it, a witness reached help, or an officer found evidence. `advance(dt,
officerPositions)` **does not take the player's position**, so it could not
cheat if it wanted to. "The police are not omniscient" is a property of a
method signature rather than a promise.

## 6. Determinism

Nothing that matters reads a clock or `Math.random` directly.

- `QuestSystem`, `TaskSystem`, `HeatSystem`, `FlightModel` and `WeaponSystem`
  are **clockless**: seconds arrive through `advance(dt)`. A seven-chapter
  story walks end to end in about a millisecond, and a full takeoff-circuit-
  landing is a unit test.
- Physics runs on a fixed step with render interpolation.
- Difficulty scales on *completions*, never randomness.
- Chunk placement and traffic use seeded RNG.

## 7. Text, and the absence of a network

Every sentence in the story lives in `src/story/strings.ts` and is reached by
key, so a missing entry renders visibly wrong rather than invisibly blank.

**Nothing in this game makes a network request except for its own assets.**
`connect-src 'self'` makes that checkable; the Life Reel is drawn on a canvas
and downloaded locally; the crash diagnostic is built in memory. There is no
analytics, no telemetry, and no account.

## 8. Invariants worth protecting

- **One material factory.** Everything routes through `makeToon()`, sharing a
  three-band ramp. `customProgramCacheKey` collapses ~99 imported materials
  onto ~23 programs. Per-object materials fragment batching immediately.
- **Palette names are colours, not semantics.** `leaf_mid` paints book spines
  and blankets. Wind, occluder fade and double-siding are opt-in and granted
  only on the vegetation path — a bug that shipped once already.
- **One collision BVH**, plus a second small overlay tree for whichever
  interior is open. Both are consulted; outdoors the overlay's root bounds
  test rejects immediately.
- **One point-light count per scene.** three.js keys its program cache on it,
  so a room lit with one light where the rest use two doubled the program
  count. The apartment's second light exists for the cache key and its comment
  says so.
- **The interior is the triangle worst case**, because `WindowPortal`
  re-renders the outdoor world for two hero rooms.

## 9. Release infrastructure

```
scripts/
  check-budgets.mjs      size gates, and eager-vs-lazy accounting
  check-chunks.mjs       every chunk deliberately one or the other
  check-story.mjs        the quest graph as a graph
  vite-plugin-pwa.ts     generates sw.js and the manifest
```

The service worker's cache name is
`lh-<version>-<sha>-s<save schema>-f<layout>`. Keyed on the **save schema**
because the failure it exists to prevent is a cached build serving a reader
older than the save it is handed. It never activates under a running game.

## 10. Debt, carried and named

- **The occlusion raycast walks the whole scene every frame.** Still the
  largest single item. Needs a registry of fadeable meshes in
  `CameraCollision`.
- **`Game.ts` is ~5,000 lines.** It is the frame loop and the wiring for
  fifteen subsystems, and every phase that needed budget space took something
  out of it. It wants splitting along the same seams the lazy chunks already
  describe.
- **A district's navmesh does not follow its streaming.** Baked once from
  whatever chunks were resident. It degrades rather than breaks.
- **Officers do not use the navmesh.**
- **Interiors are village-only.** The largest structural gap in the release.

Everything else: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
