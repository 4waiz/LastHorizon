# Performance budgets

Every figure here was measured on the Phase 1 baseline, not estimated. See
`docs/PHASE_01_BASELINE.md` for how. Budgets are enforced by
`scripts/check-budgets.mjs`, which runs in CI and fails the build on an
unexplained regression.

**Reference machine:** Windows 11, Node 24, Chromium via Playwright, DPR 1.5,
canvas 1554×1273, High quality preset auto-selected.

---

## The rule that surprises people

**The interior is the worst case for triangles — but only the two rooms that
still render a live window.**

| Scene | Draw calls | Triangles |
| --- | --- | --- |
| Village, day | 285 | 482,488 |
| Village, night | 377 | ~482,000 |
| **Interior, live portal** (home) | **252** | **514,746** |
| Interior, no portal (grocery) | 239 | 340,970 |

`WindowPortal` renders the outdoor world a second time into a half-resolution
target so the windows parallax correctly. Until Phase 7 the one interior always
paid for it. Now **two of nine do** — the family home and the apartment, the
places a player spends evenings — and the other seven get ordinary toon panes.

Draw calls are *higher* indoors than they were, and that is the price of
modularity: the Phase 1 room was one merged GLB, and a room assembled from 30
kit parts is 30 objects, doubled by the portal pass. See below.

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
| Draw calls, outdoor day | 285 | ≤ 410 |
| Draw calls, outdoor night | 377 | ≤ 500 |
| Draw calls, interior | 252 | ≤ 290 |
| Triangles, outdoor | 482 k | ≤ 700 k |
| Triangles, interior | 516 k | ≤ 880 k |
| Shader programs | 56 | ≤ 70 |
| Geometries | 198 | ≤ 260 |
| Textures | 17 | ≤ 32 |

Program count is the one to watch: material sharing plus
`customProgramCacheKey` is what keeps ~99 imported materials on ~23–40
programs. A change that multiplies programs will not show up as a frame-rate
cliff immediately, but it fragments batching.

### The interior budgets, re-derived in Phase 7 and re-measured warm in Phase 8

Measured per building in `tests/e2e/interiorBudget.spec.ts`, which runs in CI.
Population disabled, clock pinned, camera at each room's entry spawn.
Outdoors at the same moment: 294 calls, 368,558 triangles, 23 programs.

**These are the Phase 8 figures, taken on a warmed pass.** Phase 7's table
measured every room on its *first* entry, and `renderer.info.programs` counts
what has compiled — so the first room through the door was always reported
cold. It read 50 programs where the rest read 53, which is a spread of 4
against a limit of 2, and it eventually failed for that reason and no other.
The spec now takes a warm-up lap through all nine before measuring.

The numbers moved slightly and all in the same direction — a warmed pass is
2–3 draw calls and ~1–2 k triangles lower, because nothing is still being
built while it is being counted.

| Service | Portal | Draw calls | Triangles | Programs | Kit parts | Room tris |
| --- | --- | --- | --- | --- | --- | --- |
| **home** | live | **252** | **514,746** | 54 | 30 | 1,420 |
| grocery | — | 239 | 340,970 | 54 | 50 | 1,932 |
| police | — | 202 | 339,442 | 54 | 39 | 1,692 |
| clinic | — | 169 | 337,594 | 54 | 27 | 1,128 |
| garage | — | 217 | 275,626 | 54 | 47 | 1,512 |
| apartment | live | 220 | 512,226 | 54 | 21 | 840 |
| cafe | — | 187 | 275,922 | 54 | 32 | 1,588 |
| clothing | — | 203 | 275,698 | 54 | 30 | 1,476 |
| airstrip | — | 220 | 275,830 | 54 | 46 | 1,596 |

**The program spread is now 0, not 2.** Every room compiles to exactly 54, and
that is the strongest possible confirmation that the old variance was
cold-start compilation rather than a lighting difference — the thing this test
exists to catch is still caught, and it no longer reports a difference that was
never there.

**Draw calls: 240 → 290.** The Phase 1 figure of 183 was one merged GLB room.
A modular room is 30–50 separate objects, and the portal pass draws the scene
twice. 254 is the worst case and 290 leaves 14% headroom.

The named follow-up is **merging a built interior's static parts by material**
at assembly time. The kit deliberately shares materials by colour, so a room
of 50 parts should collapse to roughly the number of distinct colours in it —
call it a dozen. That would take the worst case back under 200 and is a change
to `InteriorBuilder` alone. It is not done here because the phase already
carries a renderer change (the collision overlay) and one at a time is the rule.

**Triangles: the interior is no longer uniformly the worst case.** 780 k was
the shared room with its portal; without a portal a room now runs at ~277–341 k,
*below* the outdoor scene. The 880 k budget stands, and what it protects is the
two hero interiors at ~516 k.

#### One lighting configuration, or the program count doubles

Programs sat at 53 for eight interiors and jumped to **69** the moment the
apartment was entered — against a budget of 70.

Nothing about the apartment's materials is unusual. three.js includes the
scene's **point-light count** in its program cache key, so a room lit with one
light where the others use two makes every material in the scene compile a
second time. The apartment now has two lights like everything else; the second
is 4.5 W of fill and exists for the cache key, which its comment says.

53 → 54 across all nine afterwards. **16 programs recovered for one light**,
and `interiorBudget.spec.ts` asserts the spread across the nine stays within 2
so this cannot come back unnoticed.

### The outdoor budgets, raised in Phase 6 for the population

Measured at the **documented baseline vantage** — the village start spawn
(5.4, -39.3) facing back down the road — at the `high` preset, with the
population disposed and then rebuilt. Same camera, same clock, same frame.

| | Unpopulated | Populated | Cost |
| --- | --- | --- | --- |
| Draw calls, day | 295 | 351 | **+56** |
| Draw calls, night | 371 | 413 | **+42** |
| Triangles, day | 484 k | 607 k | **+123 k** |
| Shader programs | 56 | 58 | **+2** |

The unpopulated figures land on the recorded Phase 1 baseline (285 day, 377
night, 482 k), which is what makes the comparison worth anything.

**One draw call and 4,890 triangles per person.** That is exactly the
arithmetic the merged body was built for: the player's rig is nine primitives,
so the naive clone would have been nine calls each and would have bought about
five pedestrians before the old 340 ceiling.

**Two programs, for twenty-six bodies and eight cars.** One is the body, which
is genuinely a different shader — it is vertex-coloured, and three.js keys on
that whatever `customProgramCacheKey` says. The other is the traffic paint.
Every appearance variant and every car colour shares those two, because
`makeToon` keys the *material* on colour and the *program* on kind.

Budgets: day 340 → 410, night 430 → 500, triangles 560 k → 700 k.

**Programs 55 → 70, and only 2 of that is Phase 6.** The 55 was set in Phase 1
against a measured 40 and has not been revisited across four phases of city,
vehicles, portal and interior work; the unpopulated scene is already at 56. The
number to watch is the *delta*, and this phase's is two.

**The named follow-up** is a decimated mid-tier body. A pedestrian forty metres
away does not need the player's 4,890 triangles; at ~1,200 it would give back
roughly 96 k of the 123 k. It needs a Blender change to the shared rig, which
is an asset the player also uses, and it belongs on its own commit.

### Traffic: full models up close, simplified beyond 38 m

Traffic first shipped using the `_LOD1` bodies for everything, which is 140
triangles against the full model's 424 and reads as a painted slab up close —
no wheels, a suggestion of a windscreen. Since traffic spawns 45 m away and
drives *toward* the player, up close is most of the time you look at it.

Each vehicle now carries both bodies and shows one. The switch costs nothing at
distance — the far body is what was there before — and the near body is only
paid for by the two or three cars actually beside you. Measured across the
three presets, draw calls moved by less than 10 either way while the cars went
from slabs to vehicles.

### A pre-existing cost found while measuring this

The camera's occluder fade raycasts the **entire scene** every frame with
`firstHitOnly = false`. A `SkinnedMesh` with no BVH answers that by CPU-skinning
every one of its triangles, and the player's rig is nine primitives of 4,890.
Measured at 10.6 ms per call in a dev build — the largest single item in the
frame, and it predates this phase.

Phase 6 took the player, the NPC bodies and the traffic models out of that
raycast (`mesh.raycast = () => undefined`). None of them can be occluders: the
fade only touches materials created `fadeable`, and none of theirs are. What
remains is the world itself, still walked in full every frame. The proper fix
is for `CameraCollision` to hold a registry of fadeable meshes and raycast only
those, which is a change to Phase 1 code and is recorded here rather than made
in the middle of a population phase.

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

| Measure | Covers | Phase 4 | Phase 5 | Budget *then* |
| --- | --- | --- | --- | --- |
| **initial load** | everything except lazy chunks | 3,913.6 kB | 3,917.1 kB | ≤ 4,200 kB |
| **shipped total** | everything in `dist/` | 3,913.6 kB | 6,104.2 kB | ≤ 6,600 kB |

*The budget column above is the limit as it stood in Phase 5, not today's —
this table is the record of why the split exists. `check-budgets.mjs` is the
only authority on the current numbers, and the per-phase sections below track
each change.*

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

### Raised again, 300 kB to 330 kB, in Phase 6

Two things pushed on it, and only one of them was allowed to win.

The **map panel** put the app chunk at 304.9 kB — over budget on the commit
after the Phase 5 report, which is how the phase-6 gate started red. That was
not absorbed: `HUD` now reaches its drawing code through a dynamic `import()`
on first opening, and `MapPanel-*.js` is a lazy chunk. Recovered 2.4 kB.

The **population system** is the one that needed room. Most of it is lazy for a
reason that is not negotiable: `recast-navigation` ships ~900 kB of
WebAssembly, and the initial-load budget had 77 kB of headroom. Nav had to move
off the startup path, the NPC simulation is built on nav, so the whole
population — definitions, schedules, simulation, visuals, traffic — loads after
the world is standing. What *cannot* be lazy is the part the save layer touches
whether or not anyone ever loads a village: named-NPC state and the five
relationship axes have to be readable by `SaveSchema` from the first frame.

330 kB is again deliberately close. The same rule applies to Phase 7.

### Raised again, 330 kB to 360 kB, in Phase 7

Phase 7 added 53 kB to the app chunk before any of it was split: nine interior
layouts, the registry and builder, the economy, the service layer and the task
system. **27 kB of that went lazy and 28 kB stayed**, and the split follows one
line — can it wait for a doorway?

`InteriorSubsystem-*.js` (26.5 kB) is the lazy half: the registry, the nine
layouts, the builder and the whole service layer. Going through a door already
awaits the 145 kB interior kit behind a fade to black, so the code rides along
in a gap the player is already waiting through, and somebody who never goes
inside downloads neither.

What could not move is the part the HUD and the save layer touch from the first
frame: `Wallet`, `Ledger`, `Economy` and the price catalogue — cash is on
screen before anything is built — plus `TaskSystem`, whose completion counters
are in the save format, and `InteriorKit`/`InteriorDefinition`, whose
`ServiceType` union is what `World` labels its doors with.

| | Phase 6 | Phase 7 | Budget |
| --- | --- | --- | --- |
| app chunk | 317.8 kB | 351.1 kB | ≤ 360 kB |
| JS total (startup) | 1,058.3 kB | 1,091.5 kB | ≤ 1,100 kB |
| initial load | 4,135.1 kB | 4,168.7 kB | ≤ 4,200 kB |
| shipped total | 7,147.1 kB | 7,349.1 kB | ≤ 7,400 kB |

**Initial load moved 33.6 kB for a phase that added 200 kB of content**, which
is the split doing its job. It is now 31 kB under its limit and that is the
number Phase 8 has to argue with — the shipped total has 52 kB left, which is
less headroom than it looks given the GLB budget also moved.

### Raised again in Phase 8 — and `initial load` barely moved

Phase 8 is the largest *content* addition in the project and one of the
smallest additions to what a player waits for. That gap is the whole story of
this section.

| | Phase 7 | Phase 8 | Budget |
| --- | --- | --- | --- |
| app chunk | 351.1 kB | **363.2 kB** | ≤ 375 kB *(was 360)* |
| `StorySubsystem-*.js` *(lazy)* | — | **108.4 kB** | — |
| JS total (startup) | 1,091.5 kB | 1,103.6 kB | ≤ 1,120 kB *(was 1,100)* |
| **initial load** | **4,168.7 kB** | **4,186.5 kB** | **≤ 4,200 kB** |
| shipped total | 7,349.1 kB | 7,473.8 kB | ≤ 7,600 kB *(was 7,400)* |

**120.5 kB of new code, and 17.8 kB of it reaches the loading screen.** The other
108 kB is the authored story — 35 quests, 15 dialogue trees, 9 cutscenes, 13
endings, a ~460-entry string table and the Life Reel renderer — behind a
dynamic import that only Story Mode triggers, at a moment the mode selector is
already showing a loading screen. A Free Roam player never fetches any of it.

The split line is the same one Phase 7 drew for interiors: **what does the save
layer touch on the first frame?**

- **Eager (11.6 kB).** `StoryState` — flags, recorded choices, two reputation
  numbers, the reel's event list, quest positions and the paid-reward keys —
  plus the wiring in `Game` that reports world events into it. `SaveService`
  has to read and write all of that whether or not a quest has ever loaded,
  which is the same argument that keeps `RelationshipStore` above `Population`.
- **Lazy (108 kB).** Everything else.

**Two things were moved rather than absorbed.** The catalogue was always going
to be lazy. The three Story-Mode panels — dialogue, journal, Life Reel — were
written inside `HUD` and moved out to `src/ui/StoryPanels.ts` *because this
gate said no*: the app chunk hit 365.2 kB against a 360 kB limit, and the rule
in this repository is to move something before raising a ceiling. `MapPanel`
was moved for the same reason in Phase 6. The move recovered 2.5 kB and left a
better boundary: `HUD` is the chrome that is always on, and a conversation is
not.

The remaining 2.7 kB of overage is the wiring itself and cannot be split — it
is reached from the first frame by definition. Hence 360 → 375, with about 3%
headroom, which is deliberately tight for the same reason every previous raise
was: the next phase has to come back and argue here rather than absorb it.

**The stylesheet moved 17.9 kB → 20.8 kB** against a 24 kB budget, for the
objective line, captions, the dialogue bar, the journal and the reel panel.

### Raised again in Phase 9 — and the gate turned out to be the problem

| | Phase 8 | Phase 9 | Budget |
| --- | --- | --- | --- |
| app chunk | 363.2 kB | **379.7 kB** | ≤ 390 kB *(was 375)* |
| `CombatSubsystem-*.js` *(lazy)* | — | **28.3 kB** | — |
| `weapons.glb` *(lazy)* | — | **65.1 kB** | — |
| JS total (startup) | 1,103.6 kB | **1,112.4 kB** | ≤ 1,120 kB |
| **initial load** | **4,186.5 kB** | **4,199.4 kB** | **≤ 4,200 kB** |
| shipped total | 7,473.8 kB | **7,588.2 kB** | ≤ 7,600 kB |

The split is the one this document has drawn three times now. Eager: the two
serialised blobs and four HUD mirrors in `CombatState`, because `SaveService`
has to carry a criminal record whether or not anybody has drawn a weapon.
Lazy: the weapon catalogue, the state machine, the ballistics, the crime table,
the Heat model, the police AI and the director.

`OfficerCorps` was extracted from `Game` mid-phase *because this gate said no*,
which is the same story as `StoryPanels` in Phase 8 and `MapPanel` in Phase 6.
It recovered 0.5 kB and left a better boundary: `Game` owns the frame loop and
has no business holding a list of policemen.

**Then `initial load` was raised to 4,220 kB, and then un-raised.** With that
change in, `JS total` came within **0.1 kB** of its own limit — and rather than
raise a third number, the question became what was being counted. Four chunks
were counted as startup weight that never were:

| Chunk | Why it is not startup |
| --- | --- |
| `TestRoad-` | Behind a feature flag; unreachable in normal play |
| `VehicleControls-` | `await import(...)` from `Game`, alongside `VehicleController-` |
| `VehicleAccess-` | Same |
| `VehicleDynamics-` | Same |

Only two of the five vehicle chunks had ever been listed in
`LAZY_CHUNK_PREFIXES`. Adding the four recovered **7.5 kB**, which put
`initial load` at 4,199.4 kB — under the limit that had just been declared too
small. The raise was reverted, and **the app chunk is the only budget Phase 9
moved.**

**That leaves 0.6 kB of headroom on `initial load`, and it is a tripwire.** The
next commit adding eager code fails this gate and will look like its own fault.
Phase 9 already spent the easy answer — the 7.5 kB above was a measurement
error, not slack, and there is no second one waiting. Phase 10's first budget
question is *what moves out of the app chunk*, not what number goes up.

That is now three phases running where the gate itself needed the fix
(`StorySubsystem-` in Phase 8, `CombatSubsystem-` and these four in Phase 9).
The lesson is worth keeping: a gate that under-reports headroom pushes you
toward exactly the wrong decision, so check the measurement before the ceiling.

### GLB models, 1,200 kB to 1,360 kB, in Phase 7

`interior_kit.glb` is 145.5 kB: 30 parts, 2,124 triangles. It is in
`LAZY_ASSET_FILES`, a Phase 7 addition to `check-budgets.mjs` that does for art
what `LAZY_CHUNK_PREFIXES` already did for code — it still counts toward the
GLB total and the shipped total, and is excluded only from `initial load`.

The same measurement also found the asset table in `docs/ASSET_LICENSES.md` was
wrong in two places: `player.glb` was recorded 12 kB light, and `vehicles.glb`
had no row at all despite shipping since Phase 5. Both corrected.

### Shipped total, 6,600 kB to 7,400 kB, in Phase 6

`recast-navigation` inlines its WebAssembly as base64 and bundles to 727 kB.
That is the same trade already accepted for Rapier, and taken for the same
reason: the `-compat` build needs no Vite WASM configuration, and the plain
package's separate `.wasm` — worth roughly 390 kB — is a dependency change that
belongs on its own commit with the full gate between, not folded into the phase
that first needed it. Both are now on the list of worthwhile follow-ups.

**Initial load did not move**: 4,119.8 kB before Phase 6, 4,133 kB after, out of
4,200. Recast, `Navigation`, `Population` and the map panel are all lazy, so the
13 kB of growth is the eager half — the relationship store, the LOD budgets and
the population handle in `Game`.

## Asset budget

Re-measured in Phase 7; the GLB figure had been stale since Phase 5.

| Group | Current | Budget |
| --- | --- | --- |
| GLB total | 1,280.7 kB | ≤ 1,360 kB |
| — of which fetched on demand | 145.5 kB | *(interior kit)* |
| Audio total | 1,667.8 kB | ≤ 2,000 kB |
| `icon.png` | 237.4 kB | ≤ 300 kB |

Totals live under "Bundle budget" above, split into **initial load** (≤ 4,200 kB)
and **shipped total** (≤ 7,400 kB). Both are assets *plus* JS/CSS and the HTML
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

---

## Phase 12 — the largest correction this document has carried

`initial load` **4,212.8 → 3,110.7 kB**, and no ceiling was raised to get
there. Three moves, in order of size.

### 1. `indoor.mp3` was downloaded by everybody — 1,103.7 kB

`AudioManager.buildTracks` created both music beds with `preload = 'auto'`, so
the interior bed was fetched by every player on every first visit whether or
not they ever went inside. It is `'none'` now until the first
`setZone('indoor')` — the same moment the 145 kB interior kit is fetched, and
hidden behind the same fade to black.

**That single line is worth more than every code split from Phase 6 to Phase 11
put together**, and it had been sitting inside the audio budget the whole time
being counted as startup weight. The lesson is the one this document keeps
relearning and keeps failing to apply first: *check what the number is
measuring before arguing about the ceiling.*

### 2. The district runtime, behind `CitySubsystem` — ~6.3 kB

**Owed since the Phase 4 report**, which said in as many words that this was
the answer when the app chunk next needed room. Five phases raised a ceiling
instead. `ZoneBuilder.buildZone` has returned `Promise<void> | void` since
Phase 2 and is awaited, so the seam was already there — and travel already
fades to black while it prepares the destination, so the fetch lands in a gap
the player waits through anyway.

### 3. The job catalogue, behind `taskRegistry` — ~7.1 kB

Named in the Phase 10 report, which raised `initial load` rather than doing it
and recorded that it should happen "before adding anything else eager". The
runtime looks a job up through a tiny eager registry; the six definitions are a
lazy chunk fetched alongside interiors, story or the phone.

### The app-chunk ceiling went back down

400 → **390 kB**. The pause menu raised it; the two splits above put the chunk
at 385.1 kB, under the *old* limit, so the raise was handed back. Second phase
running that a raise has been returned within the phase that granted it.

### One budget was raised: shipped total, 7,700 → 7,800 kB

And this is the case where the usual answer does not apply. **`shipped total`
counts lazy chunks too**, so moving code between chunks cannot reduce it by
construction — only deleting content or re-encoding art can, and neither is a
sensible response to adding a crash screen. The bytes are release hardening,
all of it necessarily eager: the recovery screen and its stylesheet, the
context-loss handler, the import guard, the CSP and crash markup in
`index.html`, and the service worker.

The measurement was checked before the ceiling, per the rule above:
`dist/assets` holds one `index-*.js` and one `index-*.css`, so nothing stale
was accumulating.

### `LAZY_ROOT_FILES`, and why it is not gate-gaming

`sw.js` and `manifest.webmanifest` are excluded from `initial load`. The test
applied was not "is it small" or "is it infrastructure" — it is **does the
player wait for it**:

- `sw.js` is registered inside a `window.addEventListener('load', ...)`. `load`
  has already fired and the loading screen has already had its 1.4 MB of GLB.
- `manifest.webmanifest` is fetched lazily by the browser for install UI.

What that exclusion does *not* hide: the worker then precaches roughly 2.6 MB
in the background on a first visit. That is real bandwidth, and it gets its own
line rather than being folded into a number it would misrepresent.

| Measure | Covers | 0.1.0 |
| --- | --- | --- |
| initial load | before the player can play | **3,110.7 kB** |
| first-visit background precache | shell + village, after `load` | ~2.6 MB |
| shipped total | everything in `dist/` | 7,714.1 kB |

### Scene cost, re-measured

`npm run test:perf`, production build, headless Chromium.

| Scene | Draw calls | Triangles | Programs | Textures |
| --- | --- | --- | --- | --- |
| Village, day | 264 / 410 | 434,174 / 700 k | 23 / 70 | 29 / 32 |
| Village, night | 384 / 500 | 418,003 / 700 k | 39 / 70 | 28 |
| Interior, home (live portal) | 256 / 290 | 525,886 / 880 k | 55 / 70 | **38** |
| City, Old Market | 72 / 410 | 14,934 / 700 k | 21 | 29 |

**The interior runs 38 textures against a documented ceiling of 32**, and that
ceiling was only ever measured outdoors. Now asserted against its own limit
(44) rather than left unmeasured — an unasserted number is one nobody notices
doubling. The kit's nine hero props carry their own maps and the portal target
is one more.

**The frame rate is deliberately not asserted anywhere in CI.** Headless
Chromium has no GPU and rasterises in software, so a frame time from it
describes the runner. Scene cost is renderer-reported and hardware-independent,
and it is what these budgets are written in. Real frame timing is a Chrome
DevTools trace on real hardware, by hand, recorded in the release report —
**and the mobile half of that has still never been done.**
