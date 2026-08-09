# Asset licenses

Every shipped asset, with provenance. Nothing goes into `public/` without an
entry here.

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

---

## Summary

All assets are **first-party**. No third-party art, audio, model, font or
texture is bundled. No asset is derived from any commercial game.

## 3D models — `public/assets/models/`

Generated procedurally by Python scripts driving Blender. The scripts in
`scripts/blender/` are the source of truth; the `.glb` files are committed
build output.

Sizes below were re-measured in Phase 7. Two rows were wrong before that:
`player.glb` was recorded at 348.8 kB against an actual 361.1 kB, and
`vehicles.glb` had no row at all despite shipping since Phase 5.

| File | Size | Source script | Contents |
| --- | --- | --- | --- |
| `buildings.glb` | 353.8 kB | `build_buildings.py` | HouseLarge, HouseSmall, HouseSolar, PorchHouse, Shed, HouseOpen, RoomInterior |
| `player.glb` | 361.1 kB | `build_character.py` | The explorer: ~5.0k tris, 20 bones, 6 clips, blink morph |
| `vehicles.glb` | 169.9 kB | `build_vehicles.py` | Bicycle, Scooter, Hatchback, Van, PoliceCar, each with `_LOD1` and collision proxy |
| `interior_kit.glb` | 145.5 kB | `build_interior_kit.py` | 30 modular parts, 2,124 tris total — floors, walls, doors, counters, shelves, desks, chairs, signs and nine hero props. **Fetched on demand**, not at startup |
| `nature.glb` | 112.1 kB | `build_nature.py` | TreeBig/Med/Small, Palm, DeadTree, BushA/B, RockA/B/C, GrassTuft |
| `props.glb` | 100.0 kB | `build_props.py` | Streetlight, UtilityPole, Barrier, Bench, Mailbox, FenceSection, RetainWall, Culvert, Bollard |
| `collectibles.glb` | 38.3 kB | `build_collectibles.py` | PaperPlane, ToyBoat, WindChime, OldCamera, StarOrnament |

- **Author:** Awaiz Ahmed / Kanban Studios
- **License:** proprietary, all rights reserved
- **Modifications:** n/a — generated from source in this repository

Regenerate with:

```bash
blender --background --python scripts/blender/build_all.py
```

## Audio — `public/assets/audio/`

| File | Size | Role |
| --- | --- | --- |
| `outdoor.mp3` | 564.1 kB | Outdoor music bed |
| `indoor.mp3` | 1,103.7 kB | Interior music bed |

- **Author:** Awaiz Ahmed / Kanban Studios — **original work, confirmed by
  the author on 2026-08-05**
- **License:** proprietary, all rights reserved
- **Modifications:** n/a

These layer *over* a synthesised bed; they are not the whole soundtrack. If
either file fails to load, `AudioManager` degrades to synthesis only
(`src/core/AudioManager.ts:174`, fallback at `:191`).

### Procedural audio

Everything else is synthesised at runtime from oscillators and generated noise
buffers in `src/core/AudioManager.ts`: the lo-fi chord bed (Dm9–G13–Cmaj7–Am7
with tape wobble, bell motif and vinyl hiss), filtered wind, cicadas by day and
crickets by night, birdsong, surface-dependent footsteps, transformer hum, and
the discovery arpeggio. No sample libraries.

## Images

| File | Size | Notes |
| --- | --- | --- |
| `public/icon.png` | 237.4 kB | Title-screen logo art. First-party. |

A larger master (`icon.png`, 708 kB) is kept at the repository root and is not
served. Duplicate `indoor.mp3` / `outdoor.mp3` copies also sit at the root and
are likewise not served — retained deliberately at the author's request.

## Fonts

None bundled. The UI uses system font stacks.

## Open-source libraries

Runtime dependencies, credited in-game and in the README:

| Library | License |
| --- | --- |
| three.js | MIT |
| three-mesh-bvh | MIT |
| `@dimforge/rapier3d-compat` | Apache-2.0 |
| `recast-navigation` | MIT |
| GSAP | Standard "No Charge" license |
| Vite | MIT |
| TypeScript | Apache-2.0 |
| Vitest | MIT |
| ESLint | MIT |
| Playwright | Apache-2.0 |

Rapier and Recast were both installed before they were used — Rapier in Phase 5,
Recast in Phase 2 — and both ship a copy of their WebAssembly inside the
JavaScript bundle. Neither is an *asset* in the sense the rest of this document
means, but both are redistributed in `dist/`, so both belong here.

> **GSAP note:** the standard GSAP license is free for most uses but is *not*
> an OSI open-source license, and its terms differ for paid products. Confirm
> the current terms against the intended commercial model before release.
> Flagged, not resolved.

## Adding an asset

1. Record source, author, license and modifications **here, first**.
2. Prefer generating it — Blender for hero assets and kits, Three.js for
   ordinary props, vegetation, markers and effects.
3. Never use assets ripped from a commercial game.
4. Check it against `docs/PERFORMANCE_BUDGETS.md`.
