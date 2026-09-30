# Last Horizon — A Life in Motion

**Grow up on one road. Choose the life beyond it.**

A cozy life-and-crime sandbox that runs in a browser tab. You start at fifteen
in a coastal village with one road through it. One hour of playing is one year
of your life. At eighteen the city opens, and by twenty-five you find out what
you became.

No launcher, no account, no download, no purchases. Everything saves to your
own device.

*A Kanban Studios game — [kanbanstudios.ae](https://kanbanstudios.ae).
Game Developer: Awaiz Ahmed.*

**Version 0.1.0 — release candidate.**

---

## What is actually in it

Measured against the repository on 2026-08-11, not against the design
document. Where the two have disagreed before, the repository won and the
document was wrong.

| | |
| --- | --- |
| **World** | A village, three city districts, an airstrip, a coastal route |
| **People** | 8 named village residents, 12 in the city, ambient crowds and traffic |
| **Story** | 7 chapters, 15 main missions, 20 side tasks, 15 conversations, 9 cutscenes, 13 endings across 3 families |
| **Buildings** | 9 enterable types, built from a 30-part modular kit — **all in the village; the districts have none yet** |
| **Work** | 5 repeatable jobs, 6 activities, a whole-dollar local economy |
| **Vehicles** | Bicycle, scooter, hatchback, van, patrol car, and a light aeroplane |
| **Optional** | 4 weapons, 11 crimes, a 0–5 Heat model, arrest and recovery — all gated at 18, none of it required |
| **Modes** | Story Mode, and Free Roam with a chosen age, money, vehicle and ageing rate |
| **Saves** | 3 slots plus autosave, IndexedDB, export and import, migrations from v1 |
| **Input** | Keyboard, mouse, touch and gamepad |
| **Offline** | Installable, and the village plays with no network after the first visit |

**Violence is optional, stylised and never graphic.** There is no health bar
and nobody dies — people lose composure, sit down and recover. No child is ever
a target, and a validator fails the build if one is made combat-capable. The
story can be finished on every route without committing a crime, and an
automated run proves it on every commit.

## Play

```bash
npm ci
npm run dev
```

Or build what actually ships:

```bash
npm run build && npm run preview
```

**Controls:** [docs/CONTROLS.md](docs/CONTROLS.md).
**New player:** [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md).

## Built with

TypeScript 6 (strict, no `any`), Three.js r185, Vite 7, Rapier for vehicle
physics, recast-navigation for pedestrians, GSAP for interface motion. Vitest
and Playwright for tests. Blender, driven by Python scripts in
`scripts/blender/`, for every model.

**Every art and audio asset is first-party.** No third-party model, texture,
font or sample, and nothing derived from any commercial game. Five libraries
ship in the bundle and four are permissively licensed — **GSAP is not open
source**; it is free to use under GreenSock's standard licence, which is a
different claim and is stated as such in the credits.
[docs/ASSET_LICENSES.md](docs/ASSET_LICENSES.md) has the provenance of
everything.

## The numbers

| | |
| --- | --- |
| Unit tests | **1,503** across 62 files |
| Integration tests | **7** |
| Browser scenarios | **111** across 12 specs, in Chromium, Firefox and WebKit |
| Visual, soak, performance | 7 + 4 + 5 |
| **Initial load** | **3,110.7 kB** |
| Shipped total | 7,714.1 kB |
| Console errors | **0** is the budget, and it is met |

## Working on it

```bash
npm run verify:static   # typecheck, lint, unit, integration, build, budgets — ~2 min
npm run verify          # the complete non-destructive gate, + e2e + visual — ~25 min
npm run release:check   # + performance and soak — ~45 min
```

Individually: `test`, `test:integration`, `test:e2e`, `test:visual`,
`test:soak`, `test:perf`, `check:budgets`, `check:chunks`, `check:story`.

**Read [CLAUDE.md](CLAUDE.md) before changing anything.** It is short, and the
first rule is the one that matters: *the repository is the source of truth, not
the documentation and not the last session summary.* Both have been wrong here
before — the README once claimed 79 tests when there were 85, and claimed there
were no audio files while 1.67 MB of MP3 shipped.

## Documentation

| | |
| --- | --- |
| [PLAYER_GUIDE](docs/PLAYER_GUIDE.md) · [CONTROLS](docs/CONTROLS.md) | For playing |
| [ARCHITECTURE_FINAL](docs/ARCHITECTURE_FINAL.md) · [SAVE_FORMAT](docs/SAVE_FORMAT.md) · [TEST_STRATEGY](docs/TEST_STRATEGY.md) | For building |
| [PERFORMANCE_BUDGETS](docs/PERFORMANCE_BUDGETS.md) · [ECONOMY_BALANCE](docs/ECONOMY_BALANCE.md) · [VEHICLE_TUNING](docs/VEHICLE_TUNING.md) | The numbers, and why |
| [GAME_VISION](docs/GAME_VISION.md) · [NARRATIVE_GUIDE](docs/NARRATIVE_GUIDE.md) · [QUEST_MAP](docs/QUEST_MAP.md) | The design |
| [DEPLOYMENT](docs/DEPLOYMENT.md) · [RELEASE_CHECKLIST](docs/RELEASE_CHECKLIST.md) · [RELEASE_REPORT_0.1.0](docs/RELEASE_REPORT_0.1.0.md) | Shipping |
| [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md) | **What it does not do** |
| [CHANGELOG](CHANGELOG.md) · [adr/](docs/adr/) | History and decisions |

`docs/PHASE_01_REPORT.md` … `PHASE_11_REPORT.md` record how it was built,
including what each phase got wrong.

## Honest about the gaps

Not a marketing section. The largest are:

- **The city districts have no enterable buildings.** Nine interiors exist and
  every one is in the village.
- **The mobile frame budget has never been measured on real hardware.**
- **No key remapping**, and a gamepad cannot navigate menus.
- **No photo mode**, so the `photograph` objective kind is unauthored.
- **The boat is a model and nothing else.**

The full list, with the reason for each, is
[KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Licence

Code and assets are proprietary, © Kanban Studios. Third-party library licences
are in [docs/ASSET_LICENSES.md](docs/ASSET_LICENSES.md) and in the game's own
credits screen.
