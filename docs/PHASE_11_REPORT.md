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

## 4. Against the acceptance criteria

**1. Every system added in prior phases is reachable through a coherent UI.**
**Not met.** Weapons, Heat and arrest have HUD readouts but no inventory or
record screen. Flight has no interface at all beyond the test bridge. The six
Phase 10 activities have no jobs board. `docs/UI_INVENTORY.md` §4 lists this
explicitly rather than leaving it to be discovered.

**2. The HUD remains readable without covering the environment.**
**Held, not improved.** The existing HUD is already contextual — dash only when
driving, Heat only when wanted, ammo only when armed, reticle only when aiming.
Phase 11 changed none of it, and the screenshots in this phase show the world
unobstructed. No new HUD element was added.

**3. Keyboard-only, touch and gamepad users can start, save, play and exit.**
**Not assessed.** No keyboard-only or accessibility-snapshot tests were written
this phase, so claiming it either way would be inventing a result.

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
| stylesheet | 22.1 kB | **23.9 kB** | 24 kB |
| initial load | 4,207.4 kB | **4,211.1 kB** | 4,215 kB |
| app chunk | 387.2 kB | 387.2 kB | 390 kB |

**The stylesheet has 0.1 kB left and this is a hard blocker for the rest of the
phase.** The token block and the credits styling cost 1.8 kB. Eighteen screens
will not fit in 100 bytes.

Two options, and the next session has to pick one before writing any CSS:

1. **Raise the budget** to ~40 kB. Defensible — a full interface is genuinely
   more CSS than a HUD — but it is the fourth budget raise in three phases.
2. **Split the stylesheet**, so panel CSS loads with the lazy chunk that owns
   the panel. `MapPanel` and `StoryPanels` are already lazy *modules* whose CSS
   is still eager, so the precedent and the seam both already exist.

Option 2 is the one consistent with everything Phases 6–10 did. It is also more
work, which is exactly why it should be decided before the CSS is written and
not after.

`initial load` sits at 4,211.1 / 4,215 kB — 3.9 kB. The Phase 10 note about
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
