# Architecture v2

The shape of the codebase after Phase 1, and the seams that later phases plug
into. For the current game's design notes, see the README.

---

## Layers today

```
main.ts                     boot, WebGL capability check, flag resolution
  core/
    FeatureFlags.ts         typed flags from the query string, default off
    TestMode.ts             the ?e2e=1 window.__LH_TEST__ bridge
    RendererBackend.ts      renderer seam + factory (WebGL2 today)
    Renderer.ts             WebGL2 backend
    Game.ts                 frame loop; owns and orders every subsystem
    AssetManager.ts         loads the five GLB packs
    InputManager.ts         keyboard / mouse / wheel / virtual stick
    AudioManager.ts         synthesis + two streamed music beds
    Settings.ts             quality presets, device detection, persistence
  world/                    Terrain, RoadSystem, Environment, Sky, Vegetation,
                            Birds, Collectibles, Interiors, World
  player/                   Player, PlayerController, PlayerStateMachine,
                            PlayerAnimator
  camera/                   ThirdPersonCamera, CameraCollision
  physics/                  CollisionWorld (one merged static BVH),
                            CharacterMotor
  graphics/                 ToonMaterial, StylizedShadows, PostProcessing,
                            WindowPortal
  ui/                       HUD, Minimap, LoadingScreen
```

## Seams added in Phase 1

### RendererBackend

`Game` no longer constructs a renderer directly; it calls
`createRendererBackend()`. `Renderer` implements `RendererBackend` and
declares `kind = 'webgl2'`.

WebGL2 is the release default and the only implementation. The toon look is
built from `onBeforeCompile` patches, which `WebGPURenderer` does not run, so
a backend swap is a reimplementation in TSL rather than a port. `?webgpu=1`
exercises the fallback path today. See `docs/adr/0001-renderer-backend.md`.

### FeatureFlags

Typed, resolved once from the query string, default off, never read from
storage. A flag must be asked for in the URL every time, so a stale toggle
cannot persist into ordinary play.

### TestMode

`window.__LH_TEST__` installs only under `?e2e=1`, via dynamic import so it
stays out of the main chunk. It talks to a narrow `TestSurface` built by
`Game` — a fixed set of typed operations, not a scene-graph handle.

`Game.testSurface()` is the single place where private internals are exposed,
deliberately, in one reviewable block.

## Invariants worth protecting

**One material factory.** Everything routes through `makeToon()`, sharing a
single 3-band ramp so the scene bands identically. `customProgramCacheKey`
collapses ~99 imported materials onto ~23 programs. Per-object materials
fragment batching immediately.

**Palette names are colours, not semantics.** `leaf_mid` and `leaf_teal` paint
book spines, blankets and pens as well as foliage. Wind, occluder fade and
double-siding are now opt-in and granted only on the vegetation path.

**One collision BVH.** `CollisionWorld` merges purpose-built proxy meshes, not
render meshes. Later phases must generate physics colliders from *the same*
proxy geometry, not from visual meshes.

**Interiors are a separate cell** 600 m above the terrain, because the ~2 m
heightfield is too coarse to hold a house-sized platform flat. Return position
and facing are preserved across the transition.

**The interior is the performance worst case** — `WindowPortal` re-renders the
outdoor world, taking triangles from ~482 k to ~780 k.

## Where later phases attach

| Phase | Attaches to |
| --- | --- |
| Zone streaming | `World` becomes one zone behind a `ZoneManager`; `Game` keeps owning the frame loop |
| Physics | `CollisionWorld`'s proxy geometry feeds both the BVH and a future Rapier static set; the BVH motor stays default until a parity suite passes |
| Fixed-step clock | `Game.update(dt)` is already the single simulation entry point; `TestSurface.step()` drives it deterministically |
| Save system | `Settings` and `Collectibles` already own persistence; both need migrating behind a versioned service |
| Disposal | `DisposeUtils` plus each subsystem's `dispose()` — ownership must become explicit per zone |

## Known architectural debt

- **No disposal ownership model.** Subsystems have `dispose()`, but nothing
  enforces who owns what. Zone streaming will require this.
- **The frame loop is not fixed-step.** `Game.update(dt)` takes a variable dt
  clamped to 1/15 s. A fixed-step clock with render interpolation is Phase 2
  work.
- **Interiors are one shared room** reached by all eight doors.
- **`dist/` is committed**, so build output and source can drift.
- **Vite is pinned to 7** because Rolldown's native binding is blocked by this
  machine's Smart App Control. See `docs/adr/0002-vite-7-not-8.md`.
