# Test strategy

## Layers

| Layer | Tool | Runs | Covers |
| --- | --- | --- | --- |
| Unit | Vitest (jsdom) | `npm test` | Pure logic, material rules, flags, state machines |
| Simulation | Vitest | `npm test` | Character motor against a real BVH |
| Smoke / E2E | Playwright | `npm run test:e2e` | The real game in a real browser |
| Budgets | Node script | `npm run check:budgets` | Bundle and asset size regressions |
| Content | Node script | `npm run check:story` | The authored story as a graph |

`npm run verify` runs the complete non-destructive gate.

### The content gate, added in Phase 8

`check:story` runs the same `validateStory()` the unit suite runs, from the
command line, so a content edit is checked without booting a browser. It walks
every quest, dialogue tree, cutscene and ending looking for the six failures
the phase brief names — impossible prerequisites, cycles, missing localisation,
invalid objective targets, unreachable branches, duplicate rewards — plus one
design rule: **no main-story quest may carry a `combat` objective**. That is
how "the story must never require violent crime" is a build failure rather than
a sentence in a document.

It found 120 missing strings the first time it ran, which is exactly what it
is for.

`src/story/storyValidation.ts` is deliberately **not** in the runtime import
graph: it pulls in the NPC and task catalogues to check ids against them, and
dragging those onto the startup path to re-run a check the build already ran
would be backwards.

## Current state

**1,251 tests across 49 files**, all passing. Measured 2026-08-10, after
Phase 8. The Phase 7 figure was 1,169 across 46; the three files below marked
*Phase 8* account for the difference, along with two save-migration tests.

| File | Tests | Covers |
| --- | --- | --- |
| `questSystem.test.ts` | 29 | *Phase 8.* Stage transitions, branch selection, reward idempotency across a reload, fail/retry/abandon, consequence application, the state container |
| `storyPresentation.test.ts` | 26 | *Phase 8.* Dialogue turns and stable choice indices, cutscene camera and skip, the Life Reel model, deterministic money formatting, local-only export |
| `storyContent.test.ts` | 25 | *Phase 8.* The shipped catalogue: the validator clean, content targets met, both routes walked end to end, ending variants, no unused string |

The rest of the table below is unchanged from Phase 6 and Phase 7.

| File | Tests | Covers |
| --- | --- | --- |
| `laneGraph.test.ts` | 33 | *Phase 6.* Driver-right offsets, two lanes per centreline, junction detection and priority, lights derived from elapsed time, the manifest's lane skeleton walked into centrelines |
| `npcAgent.test.ts` | 32 | *Phase 6.* Coarse movement along navmesh corners, arrival, stuck escalation, LOD attach/detach of crowd agents, schedule-driven indoors, quest override, reactions |
| `navTypes.test.ts` | 27 | *Phase 6.* The voxels-not-metres config against the character motor, geometry filtered to zone bounds, off-mesh links, crossing preference |
| `trafficRules.test.ts` | 27 | *Phase 6.* Car-following and stop-line braking, spawn refused in the player's view, the deadlock watchdog, seeded determinism |
| `perception.test.ts` | 25 | *Phase 6.* Sight cone, occlusion, hearing through walls, reaction selection, the one-frame bus |
| `dialogue.test.ts` | 19 | *Phase 6.* Deterministic barks, gated choices, and the validator that catches a conversation with no exit |
| `npcSchedule.test.ts` | 18 | *Phase 6.* The midnight wrap, the whole day walked in a millisecond, schedules that never sleep rejected |
| `npcRelationships.test.ts` | 15 | *Phase 6.* Five axes, clamping, diminishing greetings, save round-trip, rows for residents who no longer exist |
| `npcLod.test.ts` | 14 | *Phase 6.* Band hysteresis against boundary thrash, named residents ranked above passers-by, preset budgets |
| `npcCatalog.test.ts` | 13 | *Phase 6.* The shipped twenty: anchors inside their zones, schedules that resolve, and the child rule enforced rather than merely observed |
| `mapPanel.test.ts` | 19 | Projection, panning, cursor-anchored zoom, scale bar, legend coverage |
| `vehicleDefinition.test.ts` | 57 | The five vehicle classes as data; the check that `enginePower` and `zeroToTopSeconds` agree, which every vehicle once failed |
| `vehicleDynamics.test.ts` | 51 | Steering rate and falloff, the arcade automatic, capped balance torque, symmetry in both directions |
| `vehicleAccess.test.ts` | 38 | Exit placement as a search over candidates: moving, cliff, drop and blocked each refused distinctly |
| `vehicleRegistry.test.ts` | 38 | Ownership, parking, cosmetic damage, optional fuel, impound and garage recovery |
| `vehicleControls.test.ts` | 29 | Three input devices merged per axis; camera pullback and reverse hysteresis |
| `gamepad.test.ts` | 29 | Radial deadzone with rescaling, analogue triggers, edge detection |
| `vehicleAssets.test.ts` | 25 | The generated GLB against the definitions that describe it |
| `physicsWorld.test.ts` | 23 | Interpolation, the safety ceilings, and the rescue path, against a stub |
| `clocks.test.ts` | 41 | Life, world and story clocks; gating sets, birthday carry-over, why none derives from another |
| `inventory.test.ts` | 39 | Stacks, slot limits and exempt kinds, equipment/wardrobe migration, the four soft needs and their accessibility switches |
| `zones.test.ts` | 43 | Manifests, streaming hysteresis, spawn resolution, disposal ownership |
| `save.test.ts` | 39 | Versioning, v1 to v2 migration, read-back-and-compare writes, validation that refuses to strand a player |
| `interaction.test.ts` | 32 | Distance, facing and availability filtering; the press latch; hold completion; the selector |
| `world.test.ts` | 26 | Terrain/road continuity, corridor flatness, and the character motor against a real BVH — grounding, jumping, wall blocking, high-speed tunnelling at 60 m/s |
| `animationLayers.test.ts` | 25 | Layer weights and interrupted fades, additive conversion on a clone, procedural foot placement, the socket table against the rig |
| `settings.test.ts` | 22 | Preset monotonicity, device detection, persistence, corrupt-storage recovery, per-need accessibility options |
| `simulation.test.ts` | 22 | Fixed-step accumulator, determinism, spiral-of-death guard |
| `ageAppearance.test.ts` | 21 | Proportions written to the bones the clips do not key; stoop applied after the mixer; GLTFLoader's bone-name sanitisation |
| `gates.test.ts` | 19 | Age and mode gates, Free Roam options |
| `ageStages.test.ts` | 17 | Half-open age bands, blending across a birthday, proportion interpolation |
| `mathUtils.test.ts` | 15 | Clamping, frame-rate-independent damping, angle wrapping, seeded RNG determinism, noise continuity |
| `worldInteractables.test.ts` | 15 | The village's fixed interactables as typed actions: indoor/outdoor gating, facing, priority, sitting |
| `cityRuntime.test.ts` | 13 | District runtime contract, map data |
| `input.test.ts` | 11 | Key mapping, diagonal normalisation, jump consumption, blur release |
| `playerState.test.ts` | 11 | Every state transition, hysteresis bands, coyote time, hard vs soft landings |
| `collectibles.test.ts` | 9 | Persistence, stale-id rejection, reset, missing storage |
| `toonMaterial.test.ts` | 8 | Wind is opt-in — palette colour names must not trigger foliage shaders |
| `cityBuilder.test.ts` | 7 | Chunk geometry, instancing |
| `featureFlags.test.ts` | 8 | Flags default off; only documented on-forms enable them |

### Browser scenarios

**68 Playwright scenarios across 8 specs**, green in Chromium in **8.5 minutes**,
each asserting zero console errors. Measured 2026-08-09, after Phase 6.

| Spec | Scenarios | Covers |
| --- | --- | --- |
| `driving.spec.ts` | 18 | Every vehicle settling and moving, braking, reverse, steering symmetry, tunnelling, riding, righting |
| `gamepad.spec.ts` | 8 | Analogue movement, deadzone drift, unplugging mid-stride |
| `population.spec.ts` | 8 | *Phase 6.* The navmesh is real; crowd agents taken and returned; a routine and the walk to it; nobody in a wall or floating; traffic without deadlock and never spawned in view; perception by distance; relationships across a birthday and a reload; zone travel; a car driven through it all |
| `interaction.spec.ts` | 7 | Prompts, facing, priority, seated, the selector, busy states |
| `smoke.spec.ts` | 6 | Boot, day/night, interior round trip, sit/wardrobe/lie, bridge absence |
| `persistence.spec.ts` | 4 | Needs drain on active seconds, blocked clock, save round trip |
| `ageing.spec.ts` | 4 | Proportions on the real rig, a birthday, the stoop, no scene growth |
| `gestures.spec.ts` | 4 | Three upper-body overlays over locomotion, ramping, replay |

### `settle()` draws only its last frame

Worth knowing before writing a browser test. `settle(n)` used to render every
one of the `n` frames, and headless Chromium has no GPU — it rasterises in
software. With a populated village at ~600 k triangles over ~480 draw calls,
`settle(900)` was nine hundred software renders of a scene nobody looks at, and
the population spec was taking **17.8 minutes and timing out**. It now draws the
final frame only: 1.4 minutes, and the whole suite went from **1.1 hours to 8.5**.

Nothing observes an intermediate frame — screenshots, `getRenderStats` and
visual assertions all happen after `settle` returns. If a test ever does need
every frame drawn, `step(dt, true)` is still there.

**Retries are on (`retries: 1`), locally as well as in CI.** A real defect fails
twice; what a retry absorbs is the machine's mood at the tail of a long run. The
Phase 6 report has the evidence for why that was needed and what fixed most of
it. Scenarios in `population.spec.ts` are deliberately grouped several to a test
for the same reason: each one is a page boot, a WebGL context and a fetch of
~900 kB of WebAssembly.

## Principles

**Test the bug you fixed.** Every defect found gets a test that fails without
the fix. `toonMaterial.test.ts` exists because `leaf_mid` — a *palette colour*
used for book spines and blankets — was handing furniture the tree wind
shader. `featureFlags.test.ts` exists because a flag that leaked on by default
would install a debug bridge into ordinary play.

**Prefer the seam over the scene graph.** Browser tests drive the game through
`window.__LH_TEST__`, not by reaching into internals. Ad-hoc capture is not
reproducible: during Phase 1 two apparent "regressions" turned out to be
different camera framing between runs.

**Object counts beat heap size for leak detection.** Heap is noisy because GC
timing varies. Geometries, textures and program counts are the reliable signal.

**Compare lap two against lap one, not lap one against the start.** The first
interior entry *builds* the room: 132 geometries to 156, once, and flat at 156
for every lap after it. A test that allowed "+4 over the starting count" was
measuring lazy initialisation and would have gone on failing however healthy the
code was. What "no leak" means is that a second round trip allocates nothing the
first did not — and only that form would catch a real one.

The same rule caught `interiorBudget.spec.ts` in Phase 8, which had never had
it applied. It measured all nine rooms on their *first* entry, and
`renderer.info.programs` counts what has compiled — so `home`, entered first on
a fresh page, reported 50 programs where every other room reported 53. A spread
of 4 against a limit of 2, and a failure about nothing. It had been latent since
Phase 7 and only surfaced when Phase 8's lazy story import moved the opening
frames. **A test that measures a warm number on a cold pass is not flaky; it is
wrong, and it will look flaky until somebody reads it.**

**Drive the real game, not just the module.** Phase 3 shipped five bugs that
passed every unit test while the running game was broken. Phase 4 found six more
the same way, none of them visible to `tests/`: an interact button that re-fired
on whatever the first action brought into range, an additive clip corrupted by
being converted in place, and `AgeAppearance` silently finding 6 of 20 bones
because `GLTFLoader` strips the dot out of `shoulder.L`. Every one of those needed
the browser.

Phase 8 added one more to the list, and it is a good one: the story's event
queue **stopped draining while a cutscene played**, so a quest that completed
during its own scene left the `completed` event stuck forever. Chapter 7 ends
on a scene, so every run finished with a blank ending card. Every unit test
passed — `QuestSystem` had queued the event correctly and `StoryDirector` had
handled it correctly; what was wrong was the order of two lines in the frame.

**An end-to-end test that reports by id proves the graph, not the game.** The
Phase 8 route runs drive fifteen quests to completion by calling
`reportObjective(questId, objectiveId, target)` — which is the right way to
walk a *graph* in a reasonable time, and it bypasses the entire layer that
decides when an objective is satisfied. Three objective kinds shipped with no
reporter wired at all (`deliver`, `park`, `escape`), so chapter 1 was
uncompletable in a real game, and **every test passed**. They were found by
reading the wiring back against the objective list.

The gap is still open: there is no test that walks the story by *doing* things
rather than by reporting them. Closing it means a much slower browser run that
actually carries bread to a house, and it is the right next thing for this
suite.

**When a test fails, work out which of the two is wrong.** Phase 8 wrote a
browser test asserting Maryam's bolder dialogue line was locked at sixteen. It
failed, and the *test* was wrong: Phase 6 seeds her `initialRelationship` at
trust 0.4 because the player grew up in her shop. Changing the game to make the
test pass would have deleted a deliberate piece of characterisation. The test
now uses the age gate on chapter 6's crime route, which does not depend on a
seed and is the more important rule anyway.

A second one the same day: a save test tried to fake three keepsakes with
`reportObjective`, and the frame overwrote it — because `collect` objectives
are re-read off the world every frame *on purpose*, and the truth of "you have
found three" is how many you have found. The test moved to a stage whose
objectives are not world-derived.

**Make the test read state back, not repeat it.** `getAppearance()` reports what
is actually on the live bones rather than the proportions that were requested.
Reporting the input would have answered the wrong question and passed regardless
of whether anything reached the skeleton.

## Determinism

Reproducible browser capture requires pinning:

1. **The clock** — `setTimeMode('day' | 'dusk' | 'night')` stops the cycle;
   `setTime(t)` pins an exact position.
2. **The dev readout** — `prepareShot()` injects a stylesheet hiding `#debug`,
   which survives its twice-a-second refresh.
3. **Camera framing** — `teleport()` then `frameCamera()`, never a manual
   drag.
4. **Settling** — `settle(frames)` advances fixed 1/60 s steps.

**Known residual variation:** clouds drift and birds animate off elapsed time,
and wind phase advances with `uTime`. `prepareShot()` does not currently
freeze these. Visual comparison must therefore use a **tolerance**, not exact
pixel equality. Pinning `uTime` and cloud/bird phase is the obvious next
improvement to the bridge.

## Test mode safety

- Installs only under `?e2e=1`; verified absent on a plain visit.
- Loaded by dynamic import, so it is not in the main chunk.
- A fixed set of typed operations against `TestSurface` — no scene-graph
  handle, no arbitrary evaluation.

## Gaps — honest list

- **No Playwright run on Firefox or WebKit yet.** The config exists; only
  Chromium has been exercised.
- **No visual-diff assertion.** Baseline screenshots are captured and compared
  by eye plus renderer counters. A pixel-diff with tolerance is not yet wired.
- **No mobile-hardware measurement.** The mobile frame budget is unverified.
- **No touch or gamepad coverage.** The touch interact button now reports press
  *and* release, so hold-to-act works there, but neither path is tested. There
  is no gamepad code in the repository at all — the phase brief listed it, and
  claiming coverage would be claiming a feature.
- **Hold-to-act is unit-tested but unused in game.** `holdSeconds` works and has
  tests; every fixed interactable in the village is a press.
- **No soak test in CI.** The 160 s memory soak was run by hand.

## Running

```bash
npm run verify
```

Individually: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run check:budgets`, `npm run test:e2e`.
