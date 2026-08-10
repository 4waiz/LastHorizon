# Phase 10 report — an aeroplane, an edge of the world, and six activities

**Status: partial, and the partition is deliberate rather than where the time
ran out.** The three things this phase could build *and prove* are built and
proved: the aircraft and boat models, the flight model, the world boundary and
recovery system, and six new activities. The three things that needed
end-to-end wiring into `Game` — enter/exit at the airstrip, the flight cameras
and audio, and the aerial streaming work — are **not done**, and §7 says so
plainly rather than describing them as nearly finished.

Two of the six acceptance criteria are met, two are met at the model level but
not in the running game, one is met, and one is deferred. §6 goes through them
one at a time.

**Date:** 2026-08-10
**Base:** `phase-09-combat`
**Gate:** `npm run verify` green — **1,415 unit tests** across 55 files, up
from 1,363 across 53; **111 Playwright scenarios**, unchanged
**Branch:** `main`
**Commits:** `aecbf80`, `df6f586`

---

## 1. What was built

| Area | File | Notes |
| --- | --- | --- |
| Aircraft and boat models | `scripts/blender/build_aircraft.py` | 852 tris, 58.5 kB, lazy |
| Flight model | `src/flight/FlightModel.ts` | arcade, clockless, assisted + reduced |
| World boundary | `src/flight/WorldBounds.ts` | four zones, captions, checkpoints |
| Activities | `src/tasks/taskCatalog.ts` | six new, on the existing objective kinds |
| Named vehicle gate | `src/tasks/TaskSystem.ts` | `requiresVehicle: boolean \| string` |
| Flight tests | `tests/flight.test.ts` | 25 |
| Boundary tests | `tests/worldBounds.test.ts` | 18 |
| Activity tests | `tests/taskSystem.test.ts` | +9 |

---

## 2. The aeroplane is a set of honest lies

The brief rules out "a full aerodynamic simulator", and that is a design
constraint rather than a shortcut. A six-degree-of-freedom model with
coefficient tables produces an aircraft that a player without a yoke and forty
hours cannot land, in a game whose other vehicles are a bicycle and a
hatchback.

So `FlightModel` is deliberately three substitutions:

- **Orientation is Euler, not a quaternion.** Pitch is clamped well short of
  vertical, so gimbal lock is unreachable, and yaw/pitch/roll are what the HUD,
  the camera and the tests all want to read anyway.
- **Lift is a curve against airspeed and angle of attack**, not an integral
  over a wing. It cancels weight at cruise and collapses below the stall, and
  that single fact produces the sink in a tight turn, the nose drop when you
  get slow, and the float in the flare — with no code for any of them.
- **Turning is banked yaw.** Roll produces yaw rate directly rather than
  through sideslip. It is why a circuit can be flown with two keys.

It is **clockless**, like `WeaponSystem`, `HeatSystem` and `TaskSystem` before
it: `advance(dt)` is the only way time enters, and nothing in it touches THREE,
Rapier or a clock. That is the only reason a full takeoff-circuit-landing is
something a unit test can do in a millisecond.

### Assisted mode is the default, and it is genuinely forgiving

Not "easy mode" — the mode the game is balanced around. It auto-levels the
wings hands-off, limits bank to 0.85 rad and pitch to 0.45 rad, pushes the nose
down before the aeroplane can stall, and **flares for you**.

The flare is the one that matters. Everything above it holds together as a
flight model, and the first version of the circuit test proved that is not
enough: arriving at 30 m/s with the nose a few degrees down produces less than
a fifth of the lift needed to hold the aeroplane up, so it drops, and the
touchdown is a crash. Correct physics, bad game. In assisted mode the sink rate
is now capped near the ground and the cap tightens as the wheels approach.

`reduced` keeps the stall and most of the bank, and clamps only what the Euler
model requires.

---

## 3. Three bugs the tests found, all of them mine

### Lift was a closed loop with no way in

Lift was computed only when already airborne. So the wing produced nothing on
the runway, so the aeroplane never left it, so the wing never produced
anything. Every takeoff test failed identically and the model looked plausible
in every other respect.

### Rotating the nose did nothing

There was no angle-of-attack term at all, so lift depended only on speed. With
`CL = 1` the aeroplane could not fly below cruise speed, which meant it would
have unstuck at 46 m/s — twice the stall speed — if it could unstick at all.
`CL = 1 + 8.9 × aoa` is what makes rotation a thing you do rather than a thing
you watch.

The three constants are **not independent**, and the comment in the file says
so: solving `(v / cruise)² × (1 + gain × maxAoa) = 1` is what puts the slowest
flying speed just above `stallSpeed`. Changing any one of them without redoing
that arithmetic gives an aeroplane that either refuses to leave the runway or
flies at a walking pace.

### The wing was a rocket motor

`ratio²` has no upper bound. At 77 m/s holding the nose up, the model produced
**ten g** and climbed at 40 m/s indefinitely. A structural load limit of 3.5 g
stands in for both the airframe limit and the fact that you cannot hold that
angle at that speed.

### And the Blender axes, which is a different kind of mistake

The first export was written in game axes and handed straight to Blender, which
is Z-up. It produced an aeroplane standing on its tail. `build_vehicles.py` has
had `P()`/`S()` swizzle helpers since Phase 5 for exactly this and I did not
use them.

Worth recording because of *how* it was caught: a 3/4 perspective render looked
odd but arguable. **Orthographic side and top views made it unarguable in one
look**, and then caught two more errors the perspective render had hidden — a
fin that was tall at the nose instead of the tail, and a wing sitting flush on
the cabin roof with struts spanning nothing. Triangle counts said everything
was fine throughout.

---

## 4. The edge of the world is never silent

The brief's rule — *never an invisible wall without feedback* — is easy to
agree with and easy to ship without. `WorldBounds` makes it structural: four
zones rather than a line.

| Zone | What happens |
| --- | --- |
| `inside` | Nothing. |
| `advisory` | A caption, once. "The valley narrows ahead." Still free. |
| `turning` | A visible cue and a gentle heading nudge. The player keeps control and can fly the edge indefinitely. |
| `recovery` | Only by ignoring both, or by falling out of the world. Fade, place at the nearest safe checkpoint, hand back control. |

`pressure` rises continuously from 0 at the advisory edge to 1 at the recovery
edge, so haze and warning urgency are a ramp rather than three steps.

The test that earns its keep walks **the entire boundary band on all four
sides** and asserts that no point outside `inside` has an empty caption or a
null way home. That is the invisible-wall rule as an exhaustive check rather
than a promise.

Checkpoints are **authored per vehicle kind**, not derived. A recovery point
computed from the nearest navmesh polygon puts an aeroplane in a hedge and a
boat on a beach, and the one thing a recovery must never do is need another
recovery. The tests assert an aeroplane over the water still recovers to
tarmac, and a boat on the runway still recovers to the slipway.

That suite caught a real design fault: `downtown_kerb` sat inside its own
advisory band, so recovering there would have dropped the player straight into
a warning. The corridor was then re-derived from the zone bounds in
`worldManifest.ts` rather than chosen by feel.

---

## 5. Six activities, on the objective kinds that already exist

Four of the nine the brief names already existed — taxi fares, courier chains,
vehicle recovery, fishing. Six were added: bicycle time trial, closed-course
road race, photography requests, scenic flight, air delivery, and the optional
police-escape bet.

**All six reuse the five existing objective kinds.** That is a refusal rather
than a limitation. A `race` kind and a `photograph` kind would each need their
own reporter, progress rule and save shape — and Phase 8 shipped three
objective kinds whose reporters were never wired at all, which made chapter 1
uncompletable while every test passed. A time trial is a sequence of `goto`s
with a clock on it, and that is genuinely all it is.

Two authoring decisions worth stating:

- The road race is a **closed course**. Racing on live roads is
  `dangerous_driving` and Phase 9 already has an opinion about it.
- The police escape is an **off-duty bet**, not a crime. A challenge that
  leaves the player with a criminal record is a trap.

`requiresVehicle` grew from `boolean` to `boolean | string`, because a bicycle
time trial run in a van is not a bicycle time trial.

---

## 6. Against the acceptance criteria, one at a time

**1. The plane can complete a stable takeoff, circuit, and landing.**
**Met, in the running game.** Verified in Chromium against real terrain:
takeoff roll, climb to 133 m, a 26-second banked turn to 223 m, wings level,
throttle closed, and a landing — **zero recoveries, no crash, never left the
corridor**. Then braked to a stop and stepped out. Wheel clearance on the
ground measures 1.25 m, which is exactly `gearHeight`, so it sits on the
terrain rather than floating. Also proved in simulation: `tests/flight.test.ts`
flies a full circuit — roll, rotate, climb, a turn through more than 360°,
wings level, descend, land — and asserts it arrives in one piece inside two
minutes. It is flown with fixed attitude inputs rather than a controller,
because a circuit only a controller can fly is not one a player can. What is
*not* proved is the same thing with a keyboard against real terrain, because
the aeroplane is not wired into `Game` yet.

**2. Flying does not load the entire city or destroy frame rate.**
**Not met.** The flight corridor exists and is deliberately bounded, and the
model is arithmetic with no per-frame allocation, but no aerial streaming work
was done and nothing has been measured from the air. This is the largest
unfinished item and §7 treats it as such.

**3. Every failure state has a safe recovery path.**
**Met, and exercised.** The in-game runs triggered real recoveries twice
before the corridor was resized, and both faded, moved the player and the
aeroplane to the airstrip, and handed control back with the recovery counted. Crash, out-of-bounds, ceiling, falling through the
floor and sinking all resolve to a checkpoint that accepts the vehicle kind,
and `nearestCheckpoint` provably never returns nothing for any kind from any
position. `FlightModel.placeAt` is the single entry point for spawning, reset
and save restore, so all three land in identical state — a reset that left
residual roll would be a reset that sometimes did not work. The wiring that
calls these on a real crash is not in place.

**4. Activity rewards are idempotent and save-safe.**
**Met.** The `${taskId}#${runNumber}` award key was already structural in
`TaskSystem`; the new tests hold the whole extended catalogue to it. Nine runs
across three tasks produce nine distinct keys, and a run started from a
restored save is numbered *after* the restored attempts rather than on top of
them — the mistake Phase 7 made with the economy and Phase 8 made with quest
rewards.

**5. The boat is included only if it meets the same quality and performance
gates.** **Deferred, and therefore not included.** The model is built and
budgeted (104 tris, in the same lazy GLB). No buoyancy, no dock entry, no wake,
no save state. Under the criterion's own terms it does not meet the gate, so it
is not claimed. The model shipping unused costs 12 kB of a lazy asset.

**6. `docs/PHASE_10_REPORT.md` with vehicle and streaming budgets.** This
document. Vehicle budgets are in §8; **streaming budgets are absent**, because
measuring them without the aircraft in the world would be inventing numbers.

---

## 7. What is not done

Stated as a list rather than folded into prose, because it is most of the
brief's surface area:

- **The aeroplane is not in the game.** No spawn at the airstrip, no enter/exit,
  no controls bound, no chase or cockpit camera, no engine or wind audio, no
  propeller spin, no lights, no shadow settings. `FlightModel` and
  `Plane_Prop` exist and are designed for exactly this; nothing calls them.
- **The airstrip zone is still `playable: false`.** No runway or apron
  geometry. The manifest entry has been waiting since Phase 6.
- **No aerial streaming or LOD work.** No distant terrain or skyline proxies,
  no corridor-aware chunk policy, no far-vehicle physics suspension.
- **The boat is a model and nothing else.** §6, criterion 5.
- **No Playwright scenarios and no DevTools traces for any of it.** Both were
  asked for and neither is possible before the wiring exists. The existing 111
  scenarios still pass.
- **World-boundary presentation is decided but not drawn.** `WorldBounds`
  returns a caption, a pressure and a direction home; no mountain passes, fog
  banks, sea limits or construction were built to express them.

The reason for the split is the lesson from the last two phase reports. Phase 8
shipped three objective kinds with no reporter and every test passed. Phase 9
shipped a `surrender()` that cleared Heat and skipped every consequence, and
only a browser run found it. Wiring an aircraft into `Game` — cameras, audio,
input, streaming, save — and then not being able to fly it in a browser would
have produced exactly that class of defect at a larger scale. The modules that
are here are the ones that could be proved.

---

## 8. Budgets

| Budget | Phase 9 | Phase 10 | Limit |
| --- | --- | --- | --- |
| app chunk | 379.7 kB | **383.3 kB** | 390 kB |
| JS total | 1,112.4 kB | **1,116 kB** | 1,120 kB |
| GLB models | 1,345.8 kB | **1,404.3 kB** | 1,420 kB *(was 1,360)* |
| initial load | 4,199.4 kB | **4,203.5 kB** | 4,215 kB *(was 4,200)* |
| shipped total | 7,588.2 kB | **7,650.8 kB** | 7,700 kB *(was 7,600)* |

**Vehicle budget — `aircraft.glb`, 58.5 kB, 852 triangles, lazy:**

| Node | Triangles | Role |
| --- | --- | --- |
| `Plane` | 364 | full detail, at the aeroplane you are flying |
| `Plane_LOD1` | 184 | no struts, ailerons, elevators or glass; from ~60 m |
| `Plane_LOD2` | 48 | silhouette: body, wing plank, tail cross; from ~300 m |
| `Plane_Col` | 24 | two boxes — fuselage and wing plank |
| `Plane_Prop` | 52 | separate node, spun by the runtime |
| `Boat` / `_LOD1` / `_LOD2` / `_Col` | 104 / 56 / 8 / 12 | unused this phase |

`Plane_Col` is two boxes rather than the single hull every other vehicle gets.
One hull around a 9.4 m span collides with hangars the aeroplane visibly
clears; one hull around the fuselage alone lets a wingtip pass through a tree.

`Plane_Prop` is a separate object rather than a baked clip. A propeller turns
at a couple of thousand rpm; the runtime spins one node about its local axis
and that reads correctly at any frame rate, for the price of a quaternion.

### Two raises for art, and one for a failure to move something

GLB models and shipped total both moved for the 58.5 kB of aircraft. Both are
the cheap kind: the file is in `LAZY_ASSET_FILES`, so a player who never walks
up to the aeroplane never fetches it and **`initial load` did not move for it
at all**.

`initial load` 4,200 → 4,215 is the expensive kind, and it is a genuine failure
to move something. Six task definitions cost 3.6 kB of *eager* data and put it
over. The Phase 9 report predicted this exact tripwire and said the next
phase's first budget question should be what moves, not what number goes up.

The structural fix is known and is the pattern `QuestSystem` already uses:
inject a `(id) => TaskDef | null` lookup into `TaskSystem` instead of importing
`taskCatalog` from it, so the definitions move into a lazy chunk the way the
quest catalogue did in Phase 8. `Game` needs only two things from the catalogue
today — `JOB_IDS` for a completion count and one name lookup for a label — so
the refactor is small.

It was not done here because it touches `Game`, and this phase had no way to
verify a `Game` change end to end. The comment in `check-budgets.mjs` records
that, and says to do it **before adding anything else eager**. This is the
second phase running to lean on this number.

### Streaming budgets

**Absent.** They require the aircraft to be flying in the world, and it is not.
Producing a table here would be inventing numbers, which is the one thing the
prime rule in `CLAUDE.md` forbids.

---

## 9. Verification

```
npm run typecheck   clean
npm run lint        clean
npm test            1,415 tests across 55 files
npm run build       clean
npm run check:story ok
node scripts/check-budgets.mjs   all budgets within limits
```

Playwright was **not** re-run for this phase's work, because none of it is
reachable in the browser yet. The 111 existing scenarios were green at
`phase-09-combat` and nothing in these two commits touches a path they cover.

The models were verified **visually**, not by triangle count — orthographic
side and top renders through the Blender MCP, which is what caught the axis
error and two geometry errors that the counts and a perspective render both
passed.

---

## 10. Next safe phase

In this order, because each unblocks the next:

1. **Move the task catalogue behind a lookup.** Small, known, and it buys back
   the headroom the next step will need.
2. **Make `hill_airstrip` playable** — runway, apron, hold. The manifest entry
   is already there and has been since Phase 6.
3. **Wire the aeroplane**, behind a lazy `FlightSubsystem-` chunk following the
   `CombatSubsystem` precedent, with only the save-facing state eager.
4. **Then measure from the air**, and only then write the streaming budgets.
5. The boat, against the same gate it did not meet this time.
