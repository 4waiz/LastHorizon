# Changelog

All notable changes to Last Horizon.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**The save schema has its own version**, tracked separately from the game's.
It is 5 today. A save migrates forward and never backward — a save written by
a newer build is refused rather than guessed at — so a release that bumps it
says so here.

---

## [0.1.0] — 2026-08-11

First release candidate. Twelve phases of work; the eleven before this one
built the game, and this one made it defensible.

### Added — production hardening (Phase 12)

- **Crash recovery screen.** An unhandled error after boot used to freeze the
  canvas on its last frame with no explanation. It now raises a readable
  screen and offers a diagnostic file built in memory and downloaded to the
  player's own device. No endpoint.
- **WebGL context loss handling.** A driver reset, a GPU switch or a phone
  reclaiming memory now stops the loop and explains, rather than freezing. It
  asks for a reload rather than resuming — see the note in `ContextLoss.ts`.
- **Import guard for saves.** Size, depth, node count, array length, control
  characters, and `__proto__` arriving as a real own property, all refused
  before `migrateSave` forms an opinion.
- **Content Security Policy**, with `'wasm-unsafe-eval'` for Rapier and
  recast-navigation. No `eval`, no `new Function`, no remote code.
- **Offline play.** A versioned service worker keyed on the game version, the
  commit **and the save schema**, so a stale worker cannot serve code older
  than the save it is handed. A new build waits and offers an update rather
  than swapping under a running session.
- **Installable.** Web app manifest, fullscreen, landscape, maskable icon.
- **Test layers:** integration, deterministic visual regression, soak, and
  performance — `test:integration`, `test:visual`, `test:soak`, `test:perf`.
- **Save migration fixtures** for every schema version, v1 through v5.
- **`check:chunks`**, which fails when an emitted chunk is neither
  deliberately eager nor deliberately lazy.
- **Release documentation:** player guide, controls, deployment, known
  limitations, release checklist, final architecture, and this file.
- **Bug report issue template** capturing browser, device, save version and
  diagnostics.

### Changed

- **`initial load` fell 4,212.8 kB → 3,110.7 kB.** Three moves, in order of
  size: `indoor.mp3` (1,103.7 kB) no longer preloads for players who never go
  inside; the district runtime moved behind the zone-travel boundary; the job
  catalogue moved behind a lookup.
- App chunk 389.7 → 385.1 kB, and the ceiling went back 400 → 390.
- `verify` now runs the complete non-destructive gate. `verify:static` is the
  fast inner loop.

### Fixed

- `AudioManager` preloaded the indoor music bed for every player on every
  first visit, whether or not they ever went indoors.
- Two of this phase's own new tests asserted budgets against a scene they
  never reached: Story Mode gates the city, `travelTo` returned false, and the
  run stayed in the village. Both now open the gate and assert they arrived.

### Known limitations

Not a short list, and it is honest: no key remapping, no gamepad menu
navigation, the city districts have no enterable buildings, no photo mode, and
the mobile frame budget has never been measured on real hardware. The full
list is [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

---

## Before 0.1.0

The eleven phases that built the game. Each has a report in `docs/`.

| Phase | What it added |
| --- | --- |
| [11](docs/PHASE_11_REPORT.md) | Design tokens, accessibility panel, the phone, pause and save slots, and a credits screen that is factually true |
| [10](docs/PHASE_10_REPORT.md) | An aeroplane that flies a circuit, a world boundary that talks, six activities |
| [09](docs/PHASE_09_REPORT.md) | Optional adult systems: four weapons, eleven crimes, an original Heat model, police who have to be told |
| [08](docs/PHASE_08_REPORT.md) | The authored story — 15 missions, 20 side tasks, 15 conversations, 9 cutscenes, 13 endings, and the Life Reel |
| [07](docs/PHASE_07_REPORT.md) | Nine enterable buildings from a modular kit, the economy, five job loops |
| [06](docs/PHASE_06_REPORT.md) | Twenty named residents, schedules, navmesh, traffic, relationships |
| [05](docs/PHASE_05_REPORT.md) | Five ground vehicles on Rapier, ownership, garages |
| [04](docs/PHASE_04_REPORT.md) | Age stages, animation layers, interaction, inventory, four soft needs |
| [03](docs/PHASE_03_REPORT.md) | Three clocks, ageing, two modes, versioned saves |
| [02](docs/PHASE_02_REPORT.md) | Zone architecture, the city prototype, engine boundaries |
| [01](docs/PHASE_01_REPORT.md) | Toolchain, renderer seam, feature flags, test bridge, budgets, CI |

[0.1.0]: https://github.com/4waiz/LastHorizon/releases/tag/v0.1.0
