# ADR 0001 — RendererBackend seam; WebGL2 stays the default

**Status:** Accepted (Phase 1)
**Date:** 2026-08-05

## Context

Phase 1 asks for a `RendererBackend` abstraction and an explicit position on
WebGPU, without destabilising a working game.

The Last Horizon look is not a stack of post effects — it is the material
system. `ToonMaterial.makeToon()` produces `MeshToonMaterial` instances that
are then patched in `onBeforeCompile`:

- three-band gradient ramp shared across every material, so the whole scene
  bands identically under one sun;
- foliage/grass **wind** vertex displacement;
- **occluder fade**, a Bayer-dither `discard` in the fragment shader;
- lamp emissive handling;
- a `customProgramCacheKey` (`lh:<kind>:<fadeable>`) that collapses ~99
  imported materials onto 23 programs.

`WebGPURenderer` **does not call `onBeforeCompile`.** Its equivalent is the
node-material system and TSL. Pointing the existing scene at WebGPU therefore
does not "port" the look — it silently drops banding, wind and the fade, and
loses the program-cache key that keeps draw calls batched. That is a visual
regression wearing the costume of an upgrade.

Measured baseline on WebGL2 (see docs/PHASE_01_BASELINE.md): 60.2 avg FPS,
p95 16.8 ms, 285 draw calls, 482 k triangles outdoors. There is no performance
problem for WebGPU to solve here.

## Decision

1. Introduce `src/core/RendererBackend.ts`: a `RendererBackend` interface
   describing exactly what `Game` needs (`beginFrame`, `applyQuality`,
   `resize`, `size`, `info`, `dispose`, plus the underlying renderer).
2. `Renderer` (WebGL2) `implements RendererBackend` and carries
   `kind = 'webgl2'`. It stays the release default and the only
   implementation.
3. `Game` constructs via `createRendererBackend()` rather than `new Renderer`,
   so a second backend is a factory change, not surgery on `Game`.
4. `?webgpu=1` is wired to the **fallback path only**. It logs why it cannot
   be honoured and returns WebGL2. The fallback is therefore real and
   exercised today, rather than untested code waiting for its first use.

**No WebGPU backend is shipped in this phase.** The brief permits one "only if
it passes the same screenshots and gameplay tests" — it cannot, because the
shaders that produce the art direction would not run.

## Consequences

- The seam is honest: it marks where a backend swap would happen and what it
  would have to satisfy, without implying readiness.
- `RendererBackend.renderer` is typed `THREE.WebGLRenderer`, because
  `PostProcessing`, `WindowPortal`'s render targets and the `info` counters
  all require it. A future backend must widen this deliberately — the type
  will refuse to let it happen by accident.
- Bundle cost is zero: no WebGPU module is imported.

## What a WebGPU backend would have to do

Not a port of `onBeforeCompile`, but a reimplementation of the look in TSL:

1. Re-express the gradient ramp, wind and dither-fade as node materials.
2. Preserve material sharing and an equivalent program-cache key, or draw
   calls will fragment.
3. Re-implement `WindowPortal` against WebGPU render targets.
4. Match all seven baseline screenshots and pass the full gameplay suite.
5. Fall back cleanly when `navigator.gpu` is absent or adapter request fails.

An interim step exists: `WebGLRenderer.setNodesHandler()` lets TSL node
materials render under WebGL2, so the materials could be migrated and verified
*before* the renderer is swapped. That is the recommended sequencing.

## Revisit when

- The toon materials are ported to TSL and verified under WebGL2 via
  `setNodesHandler`, **or**
- a measured performance ceiling appears that WebGL2 cannot clear — the
  current numbers show none, **or**
- WebGPU support becomes broad enough that maintaining one backend rather
  than two is the simpler option.
