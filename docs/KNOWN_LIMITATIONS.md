# Known limitations

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

**Everything the release does not do, in one place.** Carried forward from the
phase reports rather than re-derived, and re-checked against the repository on
2026-08-11.

Two things this list is not. It is not a roadmap — several entries are
deliberate and will stay. And it is not softened: where a phase report said
"not done", this says not done.

---

## 1. Progress-blocking

**None known.** That is the release's fourth acceptance criterion, and it is
the one claim here with no qualifier. Both story routes are walked end to end
on every commit — the legal one and the criminal one — and every objective
*kind* has a proven reporter.

## 2. Verification gaps — what has not been measured

These are the entries most likely to hide a real problem, so they come first.

| Gap | State |
| --- | --- |
| **Mobile frame rate** | **Never measured on real hardware.** The 30 FPS Medium-preset target has been an unverified budget since Phase 1 and this release does not lift that. Everything known about mobile is inference from desktop plus scene cost. |
| **Firefox and WebKit** | Run in CI only. The development machine has Chromium alone, so local runs prove one engine of three. |
| **Frame timing in CI** | Headless Chromium has no GPU and rasterises in software, so the perf layer asserts *scene cost* (draw calls, triangles, programs) and deliberately does not assert a frame rate. Real timing is a Chrome DevTools trace on a real machine, by hand. |
| **30-minute heap soak** | The soak layer runs ~10 minutes of simulated play and asserts object counts, which is the reliable leak signal. A 30-minute heap-snapshot pass has not been run for this release. |
| **Low-memory and low-quality behaviour** | The Low preset exists and is tested; behaviour under genuine memory pressure is not. |
| **Golden path as one continuous played run** | Proved in pieces — see §7. |

## 3. Interface

- **No key remapping.** The bindings are fixed. The single largest
  accessibility gap in the release.
- **A gamepad cannot navigate menus.** It moves the character, drives, flies
  and interacts; it does not move focus through a panel. No screen in this game
  is pad-navigable, so dialogue choices, the phone and the save slots need a
  keyboard or a touch screen. Open since Phase 8.
- **No touch layout editor.** The on-screen controls are where they are.
- **No photo mode**, so the `photograph` objective kind is declared and
  unauthored, and the phone's Camera tile says "not yet" rather than opening
  something empty.
- **Messages** is present on the phone, disabled, for the same reason: nothing
  writes to a conversation store yet.
- **No character setup screen**, no inventory or equipment screen, no
  relationships screen, no property screen. Wardrobe, inventory and
  relationships are reachable through the wardrobe panel and the phone.
- **Portraits are an initial in a coloured disc.** A portrait system needs art
  nobody has drawn.
- **Dialogue history is a list, not a transcript** — it does not survive
  leaving a conversation.
- **One locale.** `t()` falls back to its key and the table is the `en` table.
  Adding a second is another table and a lookup order; nothing above
  `strings.ts` would change, and nothing has proved that.

## 4. World and content

- **The city districts have no enterable buildings.** Nine interiors exist and
  all nine are in the village. `CityRuntime` produces no doors. Chapter 4
  onward points at interior places that resolve in the village, so the
  objectives complete — but a player in Downtown has fewer buildings than the
  fiction implies. **This is the oldest open gap in the project** and the one
  most visible to a player; it is carried from Phase 7.
- **Interiors are nine rooms, not hundreds.** Deliberate, and in the deferred
  list from the beginning.
- **The boat is a model and nothing else.** 104 triangles in the same lazy GLB
  as the aeroplane; no buoyancy, no dock entry, no wake, no save state. Phase
  10 declined to claim it under its own quality gate, and this release agrees.
- **Officers walk in straight lines.** `OfficerCorps` steps toward a goal and
  snaps to terrain height; it does not use the navmesh, because the navmesh
  belongs to `Population` and an officer is not one of its agents. An officer
  will walk into a fence.
- **There is no patrol car.** A motorised pursuit moves at driving speed with
  no car model, so the player sees somebody on foot keeping up with a
  hatchback. The one place the phase asks you to look away.
- **Roadblocks are counted and never placed.**
- **Four crimes have no trigger in the world:** `trespass`, `shoplifting`,
  `dangerous_driving`, `hit_and_run`. Defined, scored and testable; nothing in
  normal play raises them.
- **A stationary wanted player is arrested repeatedly.** Each arrest is
  individually correct and nothing stops the next report arriving immediately.
  It wants a grace period after release.
- **Side tasks are authored and not offered.** Twenty of them, validated and
  startable, and `offersTask` exists on the dialogue choice type with nothing
  setting it.
- **Ambient pedestrians do not use doors**, and the mid LOD tier uses the
  player's full-detail 4,890-triangle body rather than a decimated one.
- **The `follow` objective kind is implemented and unused.**
- **`chapter_7` never lands in `completedChapters`** — it resolves an ending
  instead. Cosmetic; nothing reads the flag.

## 5. Rendering and performance

- **The occlusion raycast is still the frame's largest single item.**
  `CameraCollision` raycasts the whole scene every frame with
  `firstHitOnly = false`. Phase 6 took the player, the NPC bodies and the
  traffic out of it; the world itself is still walked in full. The fix is a
  registry of fadeable meshes.
- **`initial load` improved by 1.1 MB in this phase and the next eager change
  still needs care.** 3,110.7 kB against a 4,215 kB ceiling is real headroom
  for the first time in five phases, but the app chunk is at 385.1 / 390 kB.
- **A modular room costs more draw calls than a merged one** — 256 against
  Phase 1's single merged GLB at 183. Merging a built room's parts by material
  at assembly time should take it back under 200.
- **The interior reports 38 textures** against a documented outdoor ceiling of
  32. Now asserted against its own limit rather than left unmeasured.
- **Visual regression uses a 2% tolerance, not a pixel hash.** `prepareShot()`
  pins the clock and the dev readout but does not freeze cloud drift, bird
  animation or wind phase. It catches structural regressions and will not catch
  a subtle shading change. Pinning `uTime` is the improvement that would let the
  tolerance come down.
- **Meshopt is wired up and not used** — at this GLB size the decoder costs
  more than it saves. **KTX2/Basis is not used at all**, because the game ships
  essentially no textures: everything is vertex colour and a three-band ramp.
  Both are in the brief; both would be pure cost today, and that is a
  measurement rather than an opinion.
- **`WindowPortal` re-renders the outdoor world** for two interiors, which is
  what makes the interior the triangle worst case.

## 6. Platform and delivery

- **The service worker is hand-written, not Workbox.** Reasoning and what is
  given up in [adr/0003-hand-written-service-worker.md](adr/0003-hand-written-service-worker.md):
  no navigation preload, no range-request handling for audio, no background
  sync, and we now own the correctness of a service worker.
- **`style-src 'unsafe-inline'` is in the CSP.** Several panels build markup
  containing `style="..."` attributes. Removing them is worthwhile and not done.
- **WebGL context loss does not resume.** It stops, explains and asks for a
  reload. Resuming would leave the portal render target and ~54 patched
  programs in a state nothing has verified.
- **No WebGPU backend.** The seam exists; the toon look is built from
  `onBeforeCompile` patches that `WebGPURenderer` does not run, so a swap is a
  TSL reimplementation rather than a port. `?webgpu=1` exercises the fallback.
- **Vite is pinned to 7.** Vite 8's Rolldown native binding is blocked by this
  machine's Smart App Control — a host constraint, not an inherent one. See
  [adr/0002-vite-7-not-8.md](adr/0002-vite-7-not-8.md).
- **`dist/` is committed**, so build output can drift from source.
- **Root-level duplicate assets retained at the author's request**:
  `indoor.mp3`, `outdoor.mp3` and a larger `icon.png`. Not served.

## 7. The golden path, stated precisely

Acceptance criterion 3 asks that a fresh player can complete the prologue,
reach the city, work, buy groceries, drive, save, reload, complete the story,
enter Free Roam, trigger and resolve Heat, and fly the plane.

**Every one of those is proved, and not all in one continuous run.** The story
graph is walked start to finish on two routes in a real browser on every
commit; every objective kind has a proven reporter; the nine buildings, the
five jobs, the five vehicles, the aeroplane, Heat and arrest, and the Life
Reel each have their own browser coverage.

What does not exist is a single run that plays the *whole* story by doing
every objective rather than reporting some by id. Phase 8 recorded that gap and
the reason it matters: three objective kinds shipped with no reporter at all,
and every test passed. It is narrower now — those three are wired and proved by
doing — but the gap is real and is not rounded up.

## 8. Deferred beyond the MVP, deliberately

Not bugs. Named in the vision document from the start and still out:
multiplayer or an authoritative server, accounts and cloud saves, voice chat,
generative NPC dialogue, hundreds of interiors, a seamless metropolis,
destructible buildings, realistic gore, aircraft combat, a stock market or
crypto, real-money monetisation, a mod marketplace, a procedural infinite
world.
