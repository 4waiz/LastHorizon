# Phase 5 report — Ground vehicles

**Status: the five vehicle classes are built, drivable, persistent and
recoverable.** What is *not* done is listed in §5 rather than rounded away: no
audio profiles are wired, lights and horn are data without emitters, passenger
seats exist but nothing occupies them, and impound has no trigger.

**Date:** 2026-08-07
**Base:** `main` at the Phase 4 work (`3ae1ff4`)
**Gate:** `npm run verify` green — **724 unit tests**, up from 433.
**Browser:** Playwright scenarios green in Chromium, 0 console errors.

---

## 1. What shipped

| System | Files | Unit tests |
| --- | --- | --- |
| Physics | `src/physics/PhysicsWorld.ts` | 23 |
| Definitions | `src/vehicles/VehicleDefinition.ts` | 57 |
| Dynamics | `src/vehicles/VehicleDynamics.ts` | 51 |
| Controller | `src/vehicles/VehicleController.ts` | *(driven in-browser)* |
| Access | `src/vehicles/VehicleAccess.ts` | 38 |
| Controls & camera | `src/vehicles/VehicleControls.ts` | 29 |
| Ownership & recovery | `src/vehicles/VehicleRegistry.ts` | 38 |
| Gamepad | `src/core/GamepadReader.ts` | 29 |
| Models | `scripts/blender/build_vehicles.py` | 25 |
| Proving ground | `src/vehicles/TestRoad.ts` | — |

### One controller, not two

Rapier's ray-cast vehicle controller does not insist on four wheels, so the
bicycle is a **two-wheeled instance of the same controller** rather than a
parallel implementation. What a two-wheeler needs extra is balance, and that is
one capped torque applied after the solver.

That keeps the promise `VehicleDefinition` makes: `kind` is the only branch, and
a scooter and a van differ in numbers rather than in which code runs.

### Rapier is lazily loaded, and so is everything above it

`rapier3d-compat` inlines its 1.57 MB WebAssembly as base64, making `rapier.mjs`
**2.2 MB** — larger than everything the game shipped before it. It arrives
through a dynamic `import()` in `PhysicsWorld`, and the vehicle catalogue,
dynamics, controller and controls followed it out of the startup bundle for the
same reason. A player who never gets into a vehicle downloads none of it.

Twice during this phase the app chunk hit exactly its 300 kB limit and the fix
was to move something rather than raise the budget. The third time it could not
be moved — saves must work for a player who never drives — so `VehicleRegistry`
had its dependency on the catalogue **inverted**: it takes six rules as an
injected lookup instead of importing 11.6 kB of definitions.

### Physics runs on a fixed step

`SimulationClock` was built in Phase 2, unit-tested, and never wired in; the
loop ran on a variable `dt`. Rather than re-time the character, camera and world
— all tuned against it, all working — the accumulator wraps **physics alone**,
with `alpha` interpolating vehicle transforms for render.

Safety ceilings live in `PhysicsWorld`, not in each controller, so every body is
covered by construction: non-finite transforms and bodies below the world floor
are teleported upright and at rest; excessive linear and angular speed is
clamped with direction preserved. The rescue collapses the interpolation history
too, or the renderer would draw a teleport as a very fast drive.

### Getting in and out is a search

`exitPlacement` walks candidate spots — the seat's own door, the mirrored
offset, then behind the vehicle — proving each safe before offering it, with
three distinct refusals: `moving`, `noGround` (over a cliff), `drop` (a ledge
rather than a kerb). Clearance is checked at **ground** height, not seat height;
checking at seat height clears a spot whose floor is a metre lower, which is
exactly the case that puts a player inside geometry.

`canEnter` checks the lock **before** the key, because a locked vehicle can
still be entered by whoever holds its key. The other order makes every unlocked
bicycle demand one.

### The models

2,920 triangles for the whole fleet, 170 kB, 11 materials, no textures.

| | base | LOD1 | LOD2 | collision proxy |
| --- | --- | --- | --- | --- |
| Hatchback | 424 | 140 | 76 | 12 |
| Van | 424 | 140 | 76 | 12 |
| Police | 460 | 140 | 76 | 12 |
| Bicycle | 360 | 136 | — | 12 |
| Scooter | 296 | 112 | — | 12 |

Colour variants are a **material parameter**: every body shares one
`vehicle_paint` material the runtime retints, so a red hatchback and a blue one
are the same geometry.

---

## 2. Tuning, and why it is in its own document

Full measurements are in [VEHICLE_TUNING.md](VEHICLE_TUNING.md). The short
version: `VehicleDynamics` is pure and has 51 passing unit tests, and every
vehicle in the fleet was undriveable anyway. The force arithmetic was right; the
numbers it was handed disagreed with each other.

- Every vehicle was **3–12× too powerful**. `enginePower` and
  `zeroToTopSeconds` are two statements about the same thing and nothing kept
  them consistent. `validateDefinition` now checks them against each other.
- Braking was **25× into saturation**. `setWheelBrake` is not newtons; above
  roughly 560 for a 1,180 kg car the wheels lock and pedal pressure stops
  mattering.
- The bicycle **could not move at all**, and neither obvious cause was it: its
  suspension could not carry the rider's mass.

None of this is visible to a test of a pure function.

---

## 3. The proving ground

`?testroad=1` builds a closed course: a level 120 m straight with distance
markers, three graded slopes (5°, 12°, 20°), a crossroads, square kerbs, five
parking bays, a barrier and a ramp. Development only, defaulting off.

It justified itself immediately. The village figures had been taken on what
looked like a flat stretch of the coast road and is not:

| Hatchback | Village "flat" | Proving ground |
| --- | --- | --- |
| Acceleration | 3.02 m/s² | **3.52 m/s²** |
| Braking | 11.6 m/s² | **7.5 m/s²** |

Holding a 12° grade on the handbrake drifts **0.5 m over five seconds**.

---

## 4. Acceptance criteria, as measured

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Each vehicle entered, driven, exited, parked, saved, reloaded, recovered | Entry/exit and driving verified per vehicle in Chromium; save round trip and garage recovery covered by `vehicleRegistry.test.ts` and the driving spec |
| 2 | No tunnelling at maximum speed | Police car into a house at **45.7 km/h** stopped at z = 28.1, upright, 0 rescues. Holds only because CCD is enabled — at 28 m/s a vehicle covers 0.47 m per step |
| 3 | Two-wheelers controllable at low speed, recover from falls | Both stay upright crawling at 0.15 throttle and through a full-lock turn under power. **Fall recovery is unexercised by natural riding** — see §5 |
| 4 | Cannot exit into a wall, under a vehicle, or over a cliff | 38 tests over a `PlacementProbe`; exiting a moving vehicle is refused outright |
| 5 | Village roads remain traversable and calm | Steering lock and grip both fall off with speed; kerbs below `scratchSpeed` leave no mark; the calm-exploration feel is unchanged on foot |
| 6 | Report with tuning, limitations and budgets | This document and `VEHICLE_TUNING.md` |

### Long-drive stability

Six spawn → drive → brake → despawn laps on the proving ground, sampled through
Chrome DevTools:

| | before | after physics | after 6 laps |
| --- | --- | --- | --- |
| Heap | 22.3 MB | 29.5 MB | 33.5 MB *(range 30.2–39.3, no monotonic rise)* |
| Geometries | 147 | 147 | **147** |
| Textures | 17 | 17 | **17** |
| Programs | 23 | 23 | **23** |
| Bodies | 0 | 0 | **0** |

Object counts are the reliable leak signal and none of them moved. Frame pacing
while driving was tight — p95 within 13% of median — so physics adds no spikes.
The absolute rate in the profiling tab was vsync-limited and is **not**
comparable to the 60 fps Phase 1 baseline, which was measured in a foreground
window.

---

## 5. Not built

**No vehicle audio.** `AudioSpec` is complete data — profile, idle and max
frequency, horn pitch, volume — and `AudioManager` has no vehicle path. Driving
is silent.

**Lights and horn are data only.** Positions, colours and intensities are
defined and validated; no emitters are created, so headlights do not light and
the horn does not sound.

**Passenger seats are architecture, not gameplay.** The hatchback has four seats
and the van two, `canEnter` refuses an occupied one, and nothing ever occupies
one. That was deliberate — the MVP is single-player — but it means the
multi-occupant path is untested.

**Impound has no trigger.** `impound`, the fee and the release path are
implemented and tested; nothing in the world decides a vehicle has been left
somewhere it should not have been.

**Two-wheeler fall recovery is unexercised.** The balance assist is strong
enough that measured lean stays near 0.001 rad even at full lock under power, so
the fall path has only ever been driven by unit tests. `visualLean` supplies
cornering lean cosmetically.

**Damage is inferred from a speed drop**, not from contact events. It is cheap
and it works, but it cannot tell a kerb from a wall, and a very gradual
scrape does not register at all.

**Braking is still partly saturated** between roughly 0.4 and 1.0 pedal on the
cars. A response curve applied before Rapier would fix it.

**The proving ground sits at the terrain height under its start line**, so its
far end may clip a rise. Acceptable for a dev tool whose purpose is the flat
straight.

Still deferred from earlier phases: Recast navmesh, the lane-graph runtime, the
world debug overlay, and `boolean_diff` wall openings for windows and doors.

---

## 6. Budgets

| Artefact | Phase 4 | Phase 5 | Budget |
| --- | --- | --- | --- |
| app chunk | 285.5 kB | **298.5 kB** | ≤ 300 kB |
| three chunk | 609.1 kB | 609.1 kB | ≤ 700 kB |
| JS total *(startup)* | 1,013.6 kB | 1,020 kB | ≤ 1,100 kB |
| rapier chunk *(lazy)* | — | 2,184.9 kB | ≤ 2,400 kB |
| GLB models | 965.3 kB | **1,135.3 kB** | ≤ 1,200 kB |
| **initial load** | 3,917.1 kB | **~4,110 kB** | ≤ 4,200 kB |
| **shipped total** | 6,104.2 kB | ~6,300 kB | ≤ 6,600 kB |

The app chunk is the number to watch: 298.5 of 300 kB. Two more moves to the
lazy chunk and one dependency inversion kept it under, and there is very little
room left. The next phase that needs space should expect to split the city
runtime out behind the zone-travel boundary rather than raise the ceiling again.

`initial load` is what a player waits for. Adding a physics engine, five
vehicles and a proving ground cost it roughly 190 kB, nearly all of which is the
vehicle GLB — the 2.2 MB of Rapier is not in it.

---

## 7. Console

Three warnings, unchanged in kind from Phase 4 plus one new:

1. Three's shader compile under ANGLE/D3D (`X3557 loop only executes once`).
2. Two three.js deprecations the app still triggers — `THREE.Clock` and
   `PCFSoftShadowMap`. Ours, and still open debt.
3. Rapier's own wasm-bindgen glue, once physics has loaded:
   `using deprecated parameters for the initialization function`. **Not fixable
   from the call site** — `init.d.ts` declares `init(): Promise<void>`, so there
   is no other form to pass. It appears only after a vehicle has triggered the
   lazy load, never on startup.

Zero errors remains the budget, and is met.
