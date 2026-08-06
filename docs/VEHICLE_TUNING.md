# Vehicle tuning

Every number here was measured by driving in a browser against real Rapier, not
derived. The first set was derived, and all of it was wrong — see §2.

Measured on the Phase 5 reference build, Chromium via Playwright.

Two sets of numbers, and the difference between them is the point. The village
figures were taken on what looked like a flat stretch of the coast road and were
not: it slopes. The proving ground (`?testroad=1`) has a genuinely level 120 m
straight, and it exists because of exactly this.

| Hatchback | Village "flat" | Proving ground |
| --- | --- | --- |
| Acceleration | 3.02 m/s² | **3.52 m/s²** |
| Braking | 11.6 m/s² | **7.5 m/s²** |
| Stop from ~38 km/h | 1.30 s | **1.40 s** |

The proving-ground figures are the honest ones. Holding a 12° grade on the
handbrake drifts **0.5 m over five seconds**.

---

## 1. Current figures

| Vehicle | Mass | Top speed | Accel (3 s) | Brake decel | Stop from top | Wheels down |
| --- | --- | --- | --- | --- | --- | --- |
| Bicycle | 92 kg | 7.2 m/s | 1.11 m/s² | 6.5 m/s² | 1.10 s | 2 |
| Scooter | 174 kg | 13.5 m/s | ~2.2 m/s² | — | — | 2 |
| Hatchback | 1,180 kg | 24 m/s | 3.02 m/s² | 11.6 m/s² | 1.30 s | 4 |
| Van | 1,950 kg | 20 m/s | 2.12 m/s² | 9.9 m/s² | 1.05 s | 4 |
| Police | 1,290 kg | 28 m/s | 3.72 m/s² | 13.2 m/s² | 1.40 s | 4 |

Masses for the two-wheelers **include the rider**. A 14 kg bicycle is the frame
on its own, and the thing being simulated is a person on a bicycle.

---

## 2. What driving found that unit tests could not

`VehicleDynamics` is pure and has 51 unit tests. All of them passed while every
vehicle in the fleet was undriveable. The force arithmetic was correct; the
*numbers it was given* disagreed with each other, and no test of a pure function
can see that.

### Every vehicle was three to seven times too powerful

`enginePower` and `zeroToTopSeconds` are two statements about the same thing and
nothing kept them consistent:

| Vehicle | Implied by `zeroToTopSeconds` | Actual from `enginePower` | Over by |
| --- | --- | --- | --- |
| Bicycle | 1.31 m/s² | 15.7 m/s² | 12× |
| Scooter | 2.25 m/s² | 15.6 m/s² | 7× |
| Hatchback | 2.53 m/s² | 7.8 m/s² | 3× |
| Van | 1.54 m/s² | 6.4 m/s² | 4× |
| Police | 3.50 m/s² | 9.1 m/s² | 2.6× |

The hatchback reached 50 km/h in two seconds and lifted its front wheels pulling
away, which is how it was noticed at all.

`validateDefinition` now checks the two against each other and fails the build
if they diverge.

### Braking was 25× into saturation

`setWheelBrake` does not take newtons. It takes a per-wheel brake impulse and
the response saturates hard. Measured on the hatchback, total brake value
against the deceleration it actually produced:

| Brake value | Stop time | Deceleration |
| --- | --- | --- |
| 140 | 2.35 s | 5.1 m/s² |
| 280 | 1.60 s | 7.5 m/s² |
| 560 | 1.05 s | 11.4 m/s² |
| 1,120 | 0.25 s | **47.8 m/s²** ← wheels lock |
| 14,000 *(original)* | 0.25 s | 47.8 m/s² |

The original figures were reasoned about as newtons, so every vehicle stopped
dead from 43 km/h in a quarter of a second — and pedal pressure made no visible
difference, because the wheels locked at any pressure. The usable band is
roughly 140–560 for a 1,180 kg car; the fleet is now scaled by mass within it.

### The bicycle could not move at all

Not the engine, and not the mass: **the suspension could not carry the rider.**
`maxForce` was 900 N per wheel against 903 N of weight once the rider was
included, leaving nothing for load transfer, so the wheels never drove the
ground. Raising it to 2,400 N with a longer spring (`restLength` 0.09 → 0.12,
`maxTravel` 0.06 → 0.09) fixed it immediately.

This one is worth remembering: the symptom was "no acceleration", and both
obvious causes were wrong.

### Losses are not uniform across the fleet

Measured against the acceleration each vehicle's force implies:

- Cars achieve **80–90%**.
- Two-wheelers achieve about **32%**.

So a bicycle legitimately needs roughly three times the naive figure. The
consistency check in `validateDefinition` allows a ratio of 1.0–3.2 for exactly
this reason; a tighter band would reject a working bicycle.

---

## 3. Acceptance criteria, as measured

| Criterion | Result |
| --- | --- |
| No tunnelling at max speed | Police car into the house at (15.6, 33) at **45.7 km/h** stopped at z = 28.1, upright, 0 recoveries |
| Never launched by a blow-up | 0 rescues across every controlled run; 1 rescue during a deliberate 10 s crash test, which is the guard working |
| Two-wheelers controllable at low speed | Bicycle and scooter both stay upright crawling at 0.15 throttle and through a full-lock turn under power |
| Steering symmetry | Left and right settle within 0.02 rad of mirror on every vehicle |

---

## 4. Known limitations

**The two-wheelers are extremely stable.** Under full throttle with full lock
for five seconds the measured lean stayed at 0.001 rad — physically they barely
lean at all. The assist is doing almost all the work. That suits a calm arcade
sandbox and satisfies "controllable at low speed", but it means the *fall*
recovery path has not been exercised by natural riding, only by unit tests.
`visualLean` exists to supply the cornering lean cosmetically.

**Braking response is non-linear and partly saturated.** Pedal pressure between
roughly 0.4 and 1.0 makes less difference than it should on the cars. Worth
revisiting with a curve applied to the pedal before it reaches Rapier.

**Two-wheeler brake figures are provisional.** The scooter's isolated braking
run was disturbed by village geometry; only the bicycle's was clean.

**Tuning is against the village's terrain**, which is not flat. Figures will
shift slightly on the dedicated test road once it exists.
