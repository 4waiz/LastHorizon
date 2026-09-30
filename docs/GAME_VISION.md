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

## Where 0.1.0 leaves this

All twelve phases are done, and the promise at the top of this document is a
thing you can play from one end to the other.

| Phase | What it added | Report |
| --- | --- | --- |
| 1 | Toolchain, renderer seam, feature flags, test bridge, budgets, CI | [01](PHASE_01_REPORT.md) |
| 2 | Zone architecture, the city prototype, engine boundaries | [02](PHASE_02_REPORT.md) |
| 3 | Three clocks, ageing, modes, versioned saves | [03](PHASE_03_REPORT.md) |
| 4 | Age stages, animation layers, interaction, inventory, needs | [04](PHASE_04_REPORT.md) |
| 5 | Five ground vehicles on Rapier, ownership, garages | [05](PHASE_05_REPORT.md) |
| 6 | Twenty residents, schedules, navmesh, traffic, relationships | [06](PHASE_06_REPORT.md) |
| 7 | Nine enterable buildings, the economy, five job loops | [07](PHASE_07_REPORT.md) |
| 8 | The authored story, ages 15–25, and the Life Reel | [08](PHASE_08_REPORT.md) |
| 9 | Police, optional combat, and an original Heat model | [09](PHASE_09_REPORT.md) |
| 10 | An aeroplane, an edge of the world, six activities | [10](PHASE_10_REPORT.md) |
| 11 | Design tokens, accessibility, the phone, pause, true credits | [11](PHASE_11_REPORT.md) |
| 12 | **Production hardening: offline, security, the release gate** | [0.1.0](RELEASE_REPORT_0.1.0.md) |

## The success test, answered

> A new player opens a link, starts in the village, collects the five
> keepsakes, ages from 15 to 18 through real play, earns and drives vehicles,
> moves to the city, enters useful buildings, buys groceries, works jobs,
> builds relationships, chooses legal or criminal actions, experiences fair
> police consequences, completes a meaningful story, flies a small plane, sees
> a personal Life Reel, and continues in Free Roam — with no launcher and no
> broken state.

**Every clause of that is true, with one qualification and one caveat.**

The qualification is *"enters useful buildings"*: nine building types are
enterable and every one of them is in the village. The city districts have
streets, traffic and people, and no doors. That is the pillar most at risk —
"every building has a purpose" — and it has been flagged at the end of the
Phase 7, 8 and 12 reports rather than quietly dropped.

The caveat is that the whole loop is proved in pieces rather than as one
continuous played run. Both story routes are walked end to end on every commit
and every objective kind has a proven reporter, but part of that walk still
reports objectives by id. See `docs/KNOWN_LIMITATIONS.md` §7.
