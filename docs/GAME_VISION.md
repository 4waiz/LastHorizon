# Last Horizon — A Life in Motion

**Tagline:** *Grow up on one road. Choose the life beyond it.*
**Studio:** Kanban Studios — kanbanstudios.ae
**Game Developer:** Awaiz Ahmed

---

## The promise

> A whole life in one browser. Drive, work, make friends, move to the city,
> build a home, follow the law or break it, and watch the character grow older
> as your choices become their history.

Not a GTA clone. An original **cozy life-and-crime sandbox** with the freedom
people associate with open-world games, carried by Last Horizon's calm
low-poly identity.

The player begins at **age 15** in the existing coastal village. **60 minutes
of active play equals one in-game year.** At 18 the city chapter unlocks. The
authored story runs roughly ages 15–25, after which Free Roam continues with
aging enabled, slowed, or frozen.

## Modes

**Story Mode** — an authored village-to-city life story with age milestones,
relationships, jobs, optional crime, consequences, three broad endings, and a
post-story sandbox.

**Free Roam** — all finished regions and systems, with a chosen starting age,
money preset, owned vehicle, and whether aging runs. Labelled *Free Roam*, never
"free to play", so it is not mistaken for monetisation.

## Pillars

1. **Life moves forward.** One active hour is one year. Birthdays unlock
   appearance stages, licenses, jobs, city access, relationships, property and
   adult-only systems.
2. **Every building has a purpose.** Grocery, police station, clinic, garage,
   apartment, cafe, clothing shop, airstrip and homes are enterable and
   support real gameplay.
3. **Freedom without tonal chaos.** Legal work, errands, driving, fishing,
   photography and relationships coexist with optional theft, weapons, police
   heat and chases. Violence is stylized, non-graphic and never mandatory.
4. **A browser-first world.** Village and city stream as separate zones and
   districts. Interiors are reusable cells. Distant NPCs run cheap schedule
   simulation, not full AI.
5. **Cute, smooth, low-poly, calm.** Keep the shared toon palette, lofi sound,
   readable silhouettes, soft motion and uncluttered UI.
6. **Shareable lives.** Birthday postcards, photo mode, seeded challenges and
   an end-of-story Life Reel answering: *what did you become by 25?*

## MVP content target

- Existing village retained as the prologue region
- One compact city from three streamed districts: Old Market, Downtown,
  Waterfront
- One hill airstrip and a small coastal water route
- 8 named village NPCs, 12 named city NPCs, lightweight ambient pedestrians
- Bicycle, scooter/motorcycle, hatchback, pickup, police car, small prop
  plane, optional small boat
- 8 reusable enterable building types
- 10 main missions, 18+ side tasks, 5 repeatable job loops
- Pistol, shotgun, compact carbine after age 18, non-graphic incapacitation
- Local saves, three slots, autosave, export/import, offline-capable PWA
- Keyboard, mouse, touch and gamepad
- ~10–14 hours to story completion; open-ended Free Roam after

## Scope rule

Simulate the choices that matter, not every possible real-life action. A small
city with dense meaningful interaction beats a huge empty map. No metropolis,
no hundreds of unique interiors, no multiplayer backend in the MVP.

## Deferred beyond MVP

Multiplayer or authoritative server, accounts and cloud saves, voice chat,
generative NPC dialogue, hundreds of interiors, a seamless metropolis,
destructible buildings, realistic gore, aircraft combat, stock market or
crypto, real-money monetisation, mod marketplace, procedural infinite world.

The architecture should avoid blocking these forever. None belongs in the
first production MVP.

## The success test

A new player opens a link, starts in the village, collects the five keepsakes,
ages from 15 to 18 through real play, earns and drives vehicles, moves to the
city, enters useful buildings, buys groceries, works jobs, builds
relationships, chooses legal or criminal actions, experiences fair police
consequences, completes a meaningful story, flies a small plane, sees a
personal Life Reel, and continues in Free Roam — with no launcher and no
broken state.

## Where Phase 1 leaves this

The village prologue exists and is intact. Phase 1 built none of the above; it
established the foundation the rest depends on — modernized toolchain, a
renderer seam, typed feature flags, a deterministic test bridge, measured
performance budgets and enforced CI gates. See `docs/PHASE_01_REPORT.md`.
