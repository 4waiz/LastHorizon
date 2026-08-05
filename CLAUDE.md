# Engineering rules — Last Horizon

Permanent rules for this repository. They outrank convenience, and they
outrank finishing a task quickly.

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

---

## The prime rule

**The repository is the source of truth, not the documentation and not the
last session summary.** Both have been wrong before: the README claimed 79
tests when there were 85, and claimed "there are no audio files" while 1.67 MB
of MP3 shipped. Inspect before you edit; measure before you claim.

## Working method

- **Inspect first.** Read the code, run the commands, record real numbers.
- **Preserve what works.** Existing features stay working unless a written
  migration replaces them. Phase work is additive.
- **Tests ship with the implementation**, never afterwards.
- **Run the gate before declaring done:** `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`. All four, every time.
- **Report honestly.** Exact files changed, commands run, results, remaining
  risk. If a step was skipped, say so. If tests fail, show the output.
- One major dependency at a time, with the full gate between each.

## Code standards

- Strict TypeScript. **No `any`.** No blanket `eslint-disable`. No
  unexplained `@ts-ignore`.
- No duplicate three.js instance — `dedupe: ['three']` in both Vite and Vitest
  config exists for this reason.
- No unhandled promise rejection. No console error in normal play.
- Deprecation warnings get **fixed, not silenced**. Read the upstream source
  and confirm the replacement's semantics before renaming anything.
- Comments explain *why*, not *what*. Match the density and voice of the
  surrounding code.

## Rendering

- **WebGL2 is the release default.** See `docs/adr/0001-renderer-backend.md`.
- The toon look lives in `onBeforeCompile` patches on shared materials. Do not
  swap renderer backends without reimplementing banding, wind and the
  occluder fade, and matching every baseline screenshot.
- Materials are shared and cached by (colour, kind, flags). Do not create
  per-object materials casually — draw calls fragment immediately.
- `customProgramCacheKey` keeps ~99 imported materials on 23 programs. Any
  change that multiplies programs is a regression.

## Assets

- **Never download an asset without recording source, author, license and
  modifications** in `docs/ASSET_LICENSES.md`.
- Never use ripped assets, maps, characters, UI, sound or branding from any
  commercial game.
- Blender is for hero assets, rigs, animations, signature vehicles and modular
  kits. Ordinary props, roads, vegetation, markers and effects are generated
  in Three.js.
- `scripts/blender/` is the source of truth; the GLBs are committed build
  output.
- **Palette names are not semantics.** `leaf_mid`, `leaf_teal` and friends are
  *colours* — used for book spines, blankets and pens as much as foliage.
  Never infer behaviour from a palette name. This exact mistake shipped a bug
  where building trim and interior furniture ran the tree wind shader; see
  `tests/toonMaterial.test.ts`.

## Feature flags and test mode

- Flags are typed, resolved from the query string, and **default to off**
  (`src/core/FeatureFlags.ts`). Nothing reads them from storage.
- The `window.__LH_TEST__` bridge installs **only** under `?e2e=1`, and is
  loaded via dynamic import so it is not in the main chunk.
- The bridge is a fixed set of typed operations against a narrow
  `TestSurface`. It must never become a handle on the scene graph, and must
  never accept arbitrary code.
- No cheats, debug writes or internal endpoints reachable in normal play.

## Performance

- Budgets live in `docs/PERFORMANCE_BUDGETS.md` and are enforced in CI by
  `scripts/check-budgets.mjs`.
- **The interior is the worst case, not the village** — the window portal
  re-renders the outdoor world, taking triangles from ~482 k to ~780 k.
  Budget against the interior.
- Instance anything repeated. Cap device pixel ratio per quality preset.
- Dispose explicitly: geometry, materials, textures, render targets, audio
  nodes, event subscriptions.

## Verification

- Use Playwright for real browser interaction and screenshots; Chrome DevTools
  MCP for traces, heap snapshots and network.
- Use Context7 for version-specific library documentation rather than
  recalling an API.
- Drive the game through `__LH_TEST__` in tests, not ad-hoc DOM poking —
  ad-hoc capture is not reproducible and produced two "regressions" in Phase 1
  that were really just different camera framing.
- Test keyboard, mouse, touch and gamepad paths when they are affected.

## Scope discipline

Do not start the next phase while the current one has failing tests, a broken
build, unreviewed asset licenses or unresolved console errors. Finish with a
tagged checkpoint.

Deferred beyond the MVP, and not to be added quietly: multiplayer, accounts or
cloud saves, generative NPC dialogue, a seamless metropolis, destructible
buildings, gore, aircraft combat, real-money monetisation, procedural infinite
world.
