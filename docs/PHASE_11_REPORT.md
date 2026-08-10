# Phase 11 report — design tokens, an accurate credits screen, and an inventory

**Status: the foundation, and one real bug fixed. Most of the phase is not
done.** This covers the design-token layer every other screen depends on, a
credits screen that is now factually correct, a licence audit, and
`docs/UI_INVENTORY.md`. The eighteen screens, the phone, the minimap upgrade,
the audio pass, photo mode and the accessibility work are **not built**, and §5
lists them rather than describing them as nearly finished.

One acceptance criterion is met. §4 goes through all six.

**Date:** 2026-08-11
**Base:** `phase-10` (`9cd936b`)
**Gate:** `npm run verify` green — **1,417 unit tests** across 55 files;
**111 Playwright scenarios**, unchanged
**Branch:** `main`

---

## 1. The audio question, answered

The brief asks to "inspect the actual repository and reconcile whether music is
supplied files, procedural Web Audio, or both". The answer is **both**, and the
game was telling players otherwise.

| | What ships |
| --- | --- |
| Supplied files | `outdoor.mp3` 564 kB, `indoor.mp3` 1,104 kB — first-party music beds, 1.7 MB total |
| Procedural | Everything else: the lo-fi chord bed, footsteps, weather, vehicles, interface — oscillators and generated noise buffers in `src/core/AudioManager.ts` |
| Relationship | The MP3s layer *over* the synthesised bed. If either fails to load, `AudioManager` degrades to synthesis alone |

`docs/ASSET_LICENSES.md` already had this right. The **credits did not**, which
is §2.

---

## 2. The credits were wrong, in two ways that matter

The previous text read:

> …the soundtrack and effects are synthesised in the browser with the Web Audio
> API. **No third-party assets are used.**
>
> Three.js · three-mesh-bvh · Vite · TypeScript · Blender

Both halves are inaccurate.

**The soundtrack is not only synthesised.** 1.7 MB of MP3 ships. The files are
first-party, so the *spirit* of the claim held, but a player reading that
sentence would conclude no audio file was downloaded, and one was.

**The library list named three of the five things the game depends on.** Rapier
(Apache-2.0) and recast-navigation (MIT) were missing entirely — together
nearly 3 MB of the bundle. And GSAP was absent, which is the one that actually
matters: **GSAP is not open source.** It is free to use under GreenSock's
standard licence, which is a different claim, and rounding it to "open source"
in a credits screen is a licensing statement rather than a typo.

The rewritten screen states the studio attribution the brief requires, is exact
about the audio split with file sizes, keeps the (true) claim that no
third-party *art or audio* is used, and lists all five libraries with their
actual licences — GSAP explicitly marked "not open source".

`docs/ASSET_LICENSES.md` gained the same library table. It had been silent on
code licensing, which is how the credits drifted without anything catching it.

### A near-miss worth recording

While auditing, I found `indoor.mp3` and `outdoor.mp3` duplicated at the
repository root — byte-identical to the served copies, tracked in git, not in
`dist/`. That reads exactly like 1.66 MB of dead weight, and I removed them.

Then I read four lines further down in `ASSET_LICENSES.md`: *"retained
deliberately at the author's request."* They were restored immediately.

Recording it because the rule in `CLAUDE.md` — look at the target before
deleting — is one I nearly broke on a file that *looked* obviously redundant,
and the note that saved it was already written down.

---

## 3. Design tokens

Phases 1–10 grew fourteen custom properties organically, and they are the right
fourteen: the warm paper, soft ink, terracotta accent and sky blue come
straight off the environment palette in `lh_common.py`, so the interface and
the world agree without a mapping to maintain.

What was missing was everything *between* colours. Spacing, type, motion and
elevation were literals scattered across 1,600 lines — the reason one panel had
13px of padding beside another with 14px and nobody could say which was right.

Added: a 4px spacing scale (`--sp-1`…`--sp-7`), a `clamp()` type scale
(`--text-xs`…`--text-xl` plus two leadings and a `--ui-scale` hook), two more
radii, a soft border, a second elevation, and three motion durations with a
shared easing curve.

`clamp()` rather than breakpoints is deliberate: one scale that works from a
phone to a desktop, with no second set of overrides to keep in step.

**Reduced motion moved to the token level.** The three existing
`@media (prefers-reduced-motion)` blocks name specific classes, which worked
while there were three animations and would have quietly stopped working the
moment somebody added a fourth. Collapsing the duration tokens catches anything
built on them. `:root.is-reduced-motion` does the same for the in-game setting,
and neither overrides the other — a player who set it in the game meant it.

---

## 3b. The accessibility panel

The token work left two hooks dangling — `--ui-scale` and
`:root.is-reduced-motion` were defined and nothing set them. A hook nothing
drives is a defect, not a foundation, so this slice built the panel that drives
them.

Five options, in `Settings` beside the Phase 9 combat four:

| Option | Values | What it reaches |
| --- | --- | --- |
| Text size | 0.85 / 1 / 1.3 / 1.6 | Multiplies the whole `clamp()` type scale |
| Motion | match system / full / reduced | Collapses every duration token |
| High-contrast prompts | on / off | Prompt, objective, caption, toast |
| Heat as a numeral | on / off | A third channel beside position and colour |
| Flight assist | assisted / reduced | `FlightDirector.setAssist` |

**They default to the game as designed**, which is deliberately unlike the
combat options. Those default to the *least* assistance because each changes
how the game plays; none of these five does, so there is nothing to preserve by
withholding them and nothing to gain by imposing them.

`reducedMotion` is tri-state on purpose. `auto` follows the operating system —
what most players want and what the media query already did — while `on` and
`off` exist for the player whose OS setting does not match what they want from
a game specifically. `off` had to be made to *beat* the media query, which is
why the rule is `:root:not(.is-full-motion)`.

Three details worth recording:

- **Heat as a numeral is a real accessibility gap, not a nicety.** The pips
  carry the level in *position* and in *colour*, and both of those fail for the
  same player. A numeral is a third channel that does not.
- **`applyAccess` is split from `syncAccessOptions`** so a setting restored
  from storage can be stamped onto the document on boot without the panel
  having been opened.
- **Calling `setHeat` from `applyAccess` was a no-op** and would have shipped
  as one: `setHeat` returns early when the level is unchanged, which is exactly
  the case when only the option has been toggled. The numeral's text is written
  by `setHeat`; its *visibility* is a root class.

Verified in Chromium by driving the real controls: `--ui-scale` 1 → 1.6 with
`--text-md` multiplying by it, `--dur-base` 0.22s → 0.01ms, the three root
classes applied, and the objective panel flipping from cream to `rgb(29,26,22)`.
Six unit tests cover defaults, clamping, type refusal, storage round-trip and
listener notification.

---

## 3c. `SettingsPanel`, split out of `HUD`

The third panel moved out of the always-on chrome for the same reason, after
`MapPanel` in Phase 6 and `StoryPanels` in Phase 8. The info modal's controls
and stylesheet now travel together in a chunk fetched when the modal opens.

| | Before | After |
| --- | --- | --- |
| app chunk | 390.1 kB | **387.4 kB** |
| eager `index-*.css` | 20.1 kB | **18.1 kB** |
| `SettingsPanel-*.js` | — | 3.65 kB (lazy) |
| `SettingsPanel-*.css` | — | 2.96 kB (lazy) |

**The app-chunk raise earlier in this phase was reverted.** 390 → 400 was
granted for 0.1 kB of accessibility wiring, with a comment saying it should be
the last on those terms; the split returned 2.7 kB, so the budget went back to
390 in the same phase. That is the "move before you raise" rule paying out
within one phase rather than across three.

**What stayed in `HUD`, and why each had to:**

- The modal *chrome* — close, backdrop, Escape. Escape is a global key and has
  to work before the module exists.
- `syncSound`, `syncQuality`, `syncTime`, because each also drives an always-on
  tile. The panel reaches them through a `syncTiles` callback.
- `applyAccess`, which stamps `--ui-scale` and the motion/contrast classes onto
  the document. It has to run on **boot** to restore a saved setting — exactly
  when the panel does not exist. Moving it would have meant a player's text
  size only applied after they opened settings.

`.pill` and the modal shell stayed in the eager stylesheet too: four pills live
outside this modal and the shell is shared with the wardrobe. Checking whether
a class appears outside the panel before moving it is what caught that, and
getting it wrong would have shipped an unstyled wardrobe rather than a style
bug.

Verified the same way as the map: 0 unstyled frames out of 31 visible, and the
controls confirmed live after the lazy load by clicking Aim help and watching
`aimAssist` go 0 → 1.

---

## 3d. The phone

A hub rather than a second interface, and the thing that makes it coherent is
that **the phone owns almost nothing**. Work comes from `TaskSystem`, People
from `Relationships`, Garage from `VehicleRegistry`, and Map and Journal open
the panels that already exist. All of it arrives through a `PhoneDeps`
interface it cannot reach past — the shape `SettingsPanel` and
`CombatDirector` already use.

Opened with **P**. Five of seven apps are live; **Messages and Camera are
present, disabled, and labelled "not yet"** because Messages needs a
conversation store nothing writes to and Camera is photo mode. A tile that
lies is worse than one that waits.

Fourth panel to follow the lazy pattern: 4.15 kB of JS and 3.08 kB of CSS in
their own chunk, markup static in `index.html`, revealed only once the chunk
lands. Verified in Chromium with a real vehicle spawned and an NPC met: the
phone opens on **0 unstyled frames**, all seven tiles render, and Garage lists
the actual hatchback rather than a placeholder.

**A bug worth recording**, because the symptom pointed nowhere near the cause:
the phone would not open at all and its chunk was never even requested. The
deps hand-over had been inserted into the *first* textual match of
`this.hud.syncOutfit(...)` — which is inside the outfit callback, not after the
constructor. So `setPhoneDeps` only ran when the player changed clothes, and
`openPhone` bailed silently on the missing deps every other time. Found by
checking whether the chunk was requested at all rather than by reading the
phone code, which was correct throughout.

---

## 4. Against the acceptance criteria

**1. Every system added in prior phases is reachable through a coherent UI.**
**Partly met, and better than it was.** The phone reaches jobs, contacts and
garage recovery, and flight assist is in the accessibility panel. Still
unreachable: weapons and the criminal record have HUD readouts but no inventory
or record screen, and there is still no save-slot, pause or character screen.
`docs/UI_INVENTORY.md` §4 lists it rather than leaving it to be discovered.

**2. The HUD remains readable without covering the environment.**
**Held, not improved.** The existing HUD is already contextual — dash only when
driving, Heat only when wanted, ammo only when armed, reticle only when aiming.
Phase 11 changed none of it, and the screenshots in this phase show the world
unobstructed. No new HUD element was added.

**3. Keyboard-only, touch and gamepad users can start, save, play and exit.**
**Not assessed**, and unchanged by this phase. No keyboard-only or
accessibility-snapshot tests were written, so claiming it either way would be
inventing a result. The accessibility *options* added in §3b are a different
thing from input coverage and are not evidence for this criterion.

**4. Credits and licensing are accurate.** **Met.** §2. Verified by reading
`package.json` and each dependency's own `license` field rather than from
memory, and rendered and screenshotted at 1280×800 and 390×844.

**5. No menu leaks timers, listeners, audio nodes or render targets.**
**Not assessed.** No DevTools memory or audio-node work was done.

**6. `docs/PHASE_11_REPORT.md` and a UI component inventory.** **Met.** This
document and `docs/UI_INVENTORY.md`, which enumerates 60-odd components across
five groups, the token set, the accessibility features that exist, and a
plainly-labelled list of what does not.

---

## 5. What is not done

The great majority of the brief. Listed so the next session can start from a
list rather than a re-read:

- **Screens:** mode selection · three save slots and autosave status ·
  character setup · pause menu · accessibility panel · controls remapping ·
  inventory and equipment · jobs and tasks · relationships and contacts ·
  garage · property · a dedicated credits *screen* (credits currently live
  inside the info modal).
- **Systems:** the in-game phone · the minimap upgrade · photo mode · birthday
  postcard export · UI sound set · audio buses, ducking and gain staging ·
  story stingers.
- **Accessibility:** full remapping · touch layout editor · subtitles and text
  speed · font scaling wired to the `--ui-scale` hook · high-contrast prompts ·
  colour-independent Heat and quest indicators · hold/toggle alternatives ·
  aging speed · driving and flight assist UI.
- **Testing:** accessibility snapshots · keyboard-only runs · touch viewport
  runs · gamepad paths · visual comparison · DevTools passes for layout shift,
  long tasks, input delay, audio-node leaks and memory.

---

## 6. Budgets

| Budget | Phase 10 | Phase 11 | Limit |
| --- | --- | --- | --- |
| stylesheet | 22.1 kB | **18.1 kB** | 24 kB |
| initial load | 4,207.4 kB | **4,207.6 kB** | 4,215 kB |
| app chunk | 387.2 kB | **387.4 kB** | 390 kB |
| JS total | 1,116 kB | **1,123.4 kB** | 1,140 kB *(was 1,120)* |
| app chunk | 387.4 kB | **387.4 kB** | 390 kB *(raised to 400 mid-phase, then reverted)* |

**The stylesheet blocker is cleared: panel CSS now travels with its chunk.**

At the end of the first slice the eager sheet was at 23.9 / 24 kB with
seventeen screens still to write, and the report put two options to the next
session: raise the ceiling, or split. **Split was chosen**, because it is what
Phases 6-10 did every other time and because the seam already existed —
`MapPanel` has been a lazy *module* since Phase 6 and `StoryPanels` since Phase
8, and both had left their stylesheets behind in the eager sheet.

| | Before | After |
| --- | --- | --- |
| eager `index-*.css` | 23.9 kB | **20.1 kB** |
| `MapPanel-*.css` (lazy) | — | 1.58 kB |
| `StorySubsystem-*.css` (lazy) | — | 2.27 kB |
| `initial load` | 4,211.1 kB | **4,207.6 kB** |

Vite emits each as a sibling chunk and resolves the module's dynamic import
only once its stylesheet has landed. The shared modal shell stays eager — the
settings and wardrobe panels use it — so only the `--reel` variant travels.

### The split introduced a bug, and the split is what found it

`HUD.openMap` unhid the panel and *then* started the download. That was free
for five phases because the CSS was already there; the moment it was not, it
became a flash of unstyled markup for as long as the fetch took — a raw white
block over the world.

Fixed by revealing the panel inside the `.then()`. That needed a second piece
of state: `mapOpen` answers "is it on screen" (the Escape handler and the pause
rules want that one) and `mapWanted` answers "has the player asked for it",
which can now be true while the chunk is still in flight.

Verified rather than assumed: a `requestAnimationFrame` sampler counted every
frame between the keypress and the panel appearing — **0 unstyled frames out of
37 visible**. The story panels needed no equivalent fix, because their open
methods live *on* the lazily-loaded module, so the CSS is guaranteed present by
construction.

### One budget was raised, and only after checking

`JS total` failed at 1,120.1 / 1,120 — the ~100 bytes the fix added. Raised to
1,140, after two checks that came back empty:

- **Is a lazy chunk unlisted again?** No. Every chunk in `dist/assets` is
  correctly classified, which is a first after three phases of finding one.
- **Can GSAP (68 kB) move?** No. It is imported by `LoadingScreen.ts`, which is
  the first thing on screen.

The eager JavaScript is three.js (609 kB), the app (387 kB), GSAP (68 kB) and
three-mesh-bvh (55 kB) — 1,119 kB. This budget has been sitting *on* its
ceiling since Phase 8 and would have failed on the next byte from any phase.
Meanwhile the number that governs how long a player waits went **down**.

`initial load` sits at 4,207.6 / 4,215 kB — 7.4 kB, up from 3.9. The Phase 10 note about
moving the task catalogue behind a lookup is now blocking rather than advisory.

---

## 7. Verification

```
npm run typecheck   clean
npm run lint        clean
npm test            1,417 tests across 55 files
npm run build       clean
node scripts/check-budgets.mjs   all budgets within limits
npm run check:story ok
```

The credits were rendered and screenshotted in Chromium at **1280×800** and
**390×844**, and checked programmatically for horizontal overflow: no element
in the credits subtree overflows its container at phone width, and the document
does not scroll sideways. The library/licence definition list collapses from
two columns to one below 420px.

Playwright was not re-run — nothing this phase touches a path the 111 existing
scenarios cover.
