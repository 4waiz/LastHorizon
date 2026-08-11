# UI component inventory

What the interface is made of, what it is made *from*, and — in §4 — what the
Phase 11 brief asks for that does not exist yet.

Measured against the repository on 2026-08-11, not against the brief. Where the
two disagree, the repository wins; that is the prime rule in `CLAUDE.md` and
this document has been wrong in the other direction before.

**Rendering split:** WebGL draws the world, DOM draws the interface. Every
component below is real DOM in `index.html`, styled by `src/style.css`, wired
by `src/ui/*.ts`. Nothing in this list is drawn into the canvas, which is what
makes it reachable by a screen reader and testable by an accessibility
snapshot.

---

## 1. Design tokens

Defined once in `:root` at the top of `src/style.css`. **The rule from Phase 11
onward is that a new rule reaches for a token or explains why not.**

| Group | Tokens | Notes |
| --- | --- | --- |
| Colour | `--paper`, `--paper-dim`, `--ink`, `--ink-soft`, `--accent`, `--accent-cool`, `--sky`, `--cream` | Lifted from the environment palette in `scripts/blender/lh_common.py`, so the interface and the world agree without a mapping to maintain |
| Spacing | `--sp-1` … `--sp-7` | 4px base: 4, 8, 12, 16, 24, 32, 48 |
| Type | `--text-xs` … `--text-xl`, `--leading-tight`, `--leading-body`, `--ui-scale` | `clamp()` rather than breakpoints — one scale from phone to desktop with no overrides to keep in step |
| Shape | `--radius`, `--radius-sm`, `--radius-pill`, `--border-soft` | Rounded, not childish: 14px on panels, 8px on inline chips |
| Elevation | `--shadow`, `--shadow-sm` | Two levels only |
| Motion | `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease` | All three collapse to `0.01ms` under `prefers-reduced-motion` **or** `:root.is-reduced-motion` |
| Layout | `--safe-t/r/b/l` | `env(safe-area-inset-*)`, for notched phones |

The colour, radius and shadow tokens are Phases 1–10 and were already right.
Phase 11 added spacing, type, shape-variant, elevation-variant and motion,
which had been literals scattered across 1,600 lines — the reason one panel had
13px of padding beside another with 14px and nobody could say which was correct.

**Reduced motion is handled at the token level**, not per class. The three
older `@media (prefers-reduced-motion)` blocks name specific classes, which
worked while there were three animations and would have stopped working the
moment somebody added a fourth. Collapsing the duration tokens catches anything
built on them automatically; the named blocks remain because those use
keyframes rather than transitions.

---

## 2. Components that exist

Grouped by role. Class names are BEM-ish (`block__element--modifier`), which is
the convention Phases 1–10 established and this keeps.

### Always-on chrome

| Component | Classes | Purpose |
| --- | --- | --- |
| HUD shell | `.hud`, `.hud__stack` | The column of tiles, top-right |
| Tile button | `.tile`, `.tile__icon`, `.tile__pip` | Sound, quality, time, info, fullscreen |
| Keepsake counter | `.counter`, `.counter__sep` | `0 / 5`, with a pop animation on collect |
| Wallet | `.wallet`, `.wallet__sign` | Cash readout |
| Age band | *(in `#hud`)* | Age and birthday progress, top-left |
| Minimap | `.minimap` | Rotating radar, bottom-left |
| Hint line | `.hint` | The one-off control hint, fades after 9s |
| Debug readout | `.debug` | Behind a feature flag |

### Contextual — appear only when relevant

| Component | Classes | Shown when |
| --- | --- | --- |
| Interaction prompt | `.prompt` | Something is in reach |
| Objective line | `.objective`, `.objective__pip` | A quest stage is active |
| Toast | `.toast`, `.toast__title`, `.toast__body` | A discovery, a police line, a boundary caption |
| Caption | `.caption` | Non-musical audio cue, for the hard of hearing |
| Vehicle dash | `.dash`, `.dash__speed`, `.dash__gear`, `.dash__bars`, `.dash__bar--fuel`, `.dash__hints` | Driving only |
| Heat | `.heat`, `.heat__pip` | Wanted only — five pips, with an `aria-label` |
| Ammo | `.ammo`, `.ammo__reserve` | A firearm is equipped only |
| Reticle | `.reticle` | Aiming only; scales with weapon spread |
| Swoosh | `.swoosh`, `.swoosh__arc`, `.swoosh__spark` | Collect flourish |

### Panels and modals

| Component | Classes | Contents |
| --- | --- | --- |
| Modal shell | `.modal`, `.modal__card`, `.modal__close`, `.modal__lede` | Generic panel; `--outfit` and `--reel` variants |
| Settings | `.settings`, `.settings__note`, `.seg`, `.seg--multi`, `.pill`, `.pill--warn` | Audio, graphics, time, needs, action options |
| Controls list | `.keys`, `.keys__touch` | Keyboard reference |
| Credits | `.credits`, `.credits__studio`, `.credits__libs`, `.credits__tech` | Studio attribution, asset statement, library licences |
| Wardrobe | `.swatches`, `.swatch`, `.swatch--none` | Shirt, trousers, hat |
| Dialogue | `.dlg`, `.dlg__card`, `.dlg__portrait`, `.dlg__speaker`, `.dlg__text`, `.dlg__choices`, `.dlg__choice`, `.dlg__log` | Conversations |
| Journal | `.journal`, `.journal__quest`, `.journal__quest--side`, `.journal__stage`, `.journal__objs` | Story progress |
| Map panel | `.mapp` + `__head/body/foot/legend/scale/tools/hint/card` | Full-screen map on **M** |
| Life Reel | `.modal__card--reel`, `.reel__note`, `.reel__tools` | End-of-life summary, local export |
| Pause | `.pause` + `__card/head/title/back/body/menu/item/note/slots/slot/slotMain/slotName/slotNote/act` | **Esc** with nothing else open: Resume, Save, Load, Settings, and the three slots plus autosave |
| Phone | `.phone` + `__card/head/title/money/back/close/body/grid/app/glyph/label/soon/list/row/rowMain/rowSide/rowName/rowNote/pay/act/empty/foot` | Hub on **P**: Work, People, Garage, Map, Journal |

### Boot and platform

| Component | Classes | Purpose |
| --- | --- | --- |
| Loading screen | `.loading`, `.loading__title/bar/fill/stage/meta/start` | Animated title with a painted scene |
| Painted scene | `.sky`, `.sunglow`, `.scenery`, `.cloud`, `.blades`, `.birds`, `.motes`, `.halo` | Parallax, drifting clouds, rising motes |
| Logo | `.logo`, `.logo__sheen` | Wordmark with a slow sheen |
| Touch controls | `.touch`, `.stick`, `.stick__knob`, `.touch__act/jump/run` | Shown only on touch devices |
| Rotate nag | `.rotate`, `.rotate__icon` | Portrait phone in a landscape game |
| Fade | `.fade` | Transition curtain — arrests, recoveries, doors |
| No-script | `.noscript` | Graceful refusal |

---

## 3. Accessibility features that exist

| Feature | Where |
| --- | --- |
| Aim assist (0 / some / full) | Settings → Action |
| Camera shake (off / half / normal) | Settings → Action |
| Flashes toggle (photosensitivity) | Settings → Action |
| Combat difficulty (gentle / normal / hard) | Settings → Action |
| Flight assist (assisted / reduced) | Settings → Accessibility |
| Text size (0.85 / 1 / 1.3 / 1.6) | Settings → Accessibility; drives `--ui-scale` |
| Motion (match system / full / reduced) | Settings → Accessibility; tri-state |
| High-contrast prompts | Settings → Accessibility |
| Heat as a numeral | Settings → Accessibility; a third channel beside position and colour |
| Per-need toggles ×4, needs speed | Settings → Needs |
| Reduced motion | OS media query **and** `:root.is-reduced-motion` |
| Safe-area insets | Token-level, all panels |
| Heat readout has an `aria-label` | `HUD.setHeat` |
| Touch controls with press *and* release | `.touch__act` |

---

## 4. What the Phase 11 brief asks for that does not exist

Listed plainly, because a component inventory that omits the gaps is a
marketing document. Re-measured against the repository after the Phase 10
leftovers were finished, not against the previous version of this list.

**Partly built:** the phone — five of seven apps are live (Work, People,
Garage, and Map/Journal by delegation). **Messages and Camera are present but
disabled and labelled "not yet"**: Messages needs a conversation store nothing
writes to yet, and Camera is photo mode, which is its own piece of work. A tile
that lies is worse than one that waits.

### Built since this section was first written

- Three save slots and autosave status, and the pause menu — `PauseMenu`, lazy
- The dedicated accessibility panel — `SettingsPanel`, lazy
- **Inventory and equipment · criminal record · property** — `LifePanel`,
  lazy, opened with I. One panel with three tabs, because they answer one
  question and three keybinds for that is three things to remember
- **Flight instruments** — airspeed, height, throttle, stall warning and the
  boundary line, contextual on the HUD

### A correction

**Story Mode / Free Roam selection has existed since Phase 8** and this
document said twice that it did not. `LoadingScreen.buildModeRow` builds the
row, `presetMode` locks it for a resumed run so a save cannot have its rules
changed underneath it, and `main.ts` hands the choice to `Game.begin`.

The claim was inherited from one revision of this list to the next without
being re-measured against the repository — which is the exact failure the
prime rule in `CLAUDE.md` exists to prevent, committed in the document whose
job is to be accurate about the interface. Recorded rather than quietly
deleted.

### Screens still not built

Character name and appearance setup · jobs and tasks as a screen of their own
· dedicated credits *screen* (credits currently live inside the info modal).

### Systems built since

- **Photo mode** — `src/ui/PhotoMode.ts`, lazy. Freezes the clocks, hides the
  interface, lens and tilt, thirds guides, PNG download. Reached with `K` or
  the phone's Camera tile, which no longer says "not yet".
- **Audio buses, ducking and gain staging** — five levels, music and ambience
  ducking under stingers, interface on its own bus.
- **UI sound set and story stingers** — synthesised, no samples.
- **Minimap upgrade** — police search area drawn from `Heat.belief` (where
  they *think* you are), owned vehicles, the parked aeroplane. Every marker
  kind is a different shape, not only a different colour.

### Systems still not built

Minimap filters and streamed-zone awareness · birthday postcard export.

### Accessibility built since

- **Full key remapping** — `src/core/Keybindings.ts`. Every action rebindable;
  arrows and Enter are fixed alternates that cannot be taken away, so no
  layout can strand a player. `Escape` is reserved. A rebind steals the key
  and names the action that lost it.
- **Subtitles, on by default** — a caption nobody needs is small text; a
  missing caption is content somebody cannot have.
- **Text speed** — a multiplier on how long anything read-without-dismissing
  dwells. The range is lopsided about 1 because slower is the accessible
  direction.
- **Five audio buses with levels** — interface separate from world effects,
  so buttons can be silenced without silencing footsteps.

### Accessibility still not built

Touch layout editor · colour-independent *quest* indicators (Heat and the
equipped-item marker are both done) · hold/toggle alternatives · aging speed
selection · driving assist.

Flight assist had a settings control and no instruments to use it with; it
now has both.

### Reachability (criterion 1)

Weapons, Heat, arrest and the aeroplane all have screens now. **The plainest
gap in this document was the flight one** — `FlightState` had mirrored
airspeed, altitude and the stall warning since Phase 10 specifically so the
HUD could read them without the flight chunk being present, and nothing ever
did.

Still unreachable: the six Phase 10 activities have no board of their own.
The phone's Work app lists the job catalogue; the activities are a separate
list and appear in neither.

### Evidence (criteria 3 and 5)

`tests/e2e/ui.spec.ts` is the first browser evidence for either. It covers
keyboard-only reach, arrow-key tab movement with wrapping, the Escape cascade
not falling through to pause, roving tabindex, dialog and tablist roles,
lazy-chunk fetch timing **read off the network** rather than off file names,
stylesheet-applied-before-reveal, forty open/close cycles returning the DOM
node count, and zero console errors throughout.

All three input paths are now evidenced, across three spec files:

| File | Covers |
| --- | --- |
| `tests/e2e/ui.spec.ts` | Keyboard-only reach, tab strips, the Escape cascade, remapping end to end, lazy-chunk fetch timing, forty open/close cycles |
| `tests/e2e/touch.spec.ts` | Emulated iPhone 13, real touch events: on-screen controls, tap-to-open and tap-to-close, a setting operated by tap, no sideways scroll, rotation |
| `tests/e2e/access.spec.ts` | Roles and accessible names on every screen; gamepad seen, moving the character, leaving a panel, and unplugging mid-session |

**The gamepad test found a real bug.** `Enter` is a fixed alternate for
`interact`, the key listener is on `window`, and it called `preventDefault()`
— so tabbing to a HUD tile and pressing Enter did nothing at all. Fixed by
having `InputManager` ignore presses aimed at a button, link, form control or
contenteditable.

Still missing: a DevTools heap snapshot and an audio-node count.

---

## 5. Conventions

1. **Semantic HTML first.** `<section>`, `<dl>`, `<button>`, `<h3>`/`<h4>`. The
   credits use a definition list because library-and-licence *is* a definition
   list, and that reads correctly to a screen reader as well as to the eye.
2. **BEM-ish naming**, `block__element--modifier`.
3. **All markup is static in `index.html`;** the `src/ui/*.ts` files wire
   behaviour to it. Nothing builds panels from strings at runtime.
4. **`[hidden]` is forced to `display: none`** globally, because several panels
   set an explicit `display` that would otherwise beat the UA rule and leave an
   invisible modal swallowing clicks.
5. **Panels that are only reachable behind a keypress live in a lazy chunk** —
   `MapPanel` since Phase 6, `StoryPanels` since Phase 8, `SettingsPanel`
   since Phase 11 — all three moved out of `HUD` when the app-chunk budget
   refused them.

   What cannot move with a panel is anything that has to run **on boot**:
   `HUD.applyAccess` stamps the accessibility settings onto the document and
   stayed behind for exactly that reason, because a text size that only
   applies once you open settings is not a restored setting.
6. **A lazy panel's CSS travels with its code.** Phase 11 moved `.mapp*` into
   `src/ui/MapPanel.css` and `.dlg*`/`.journal*`/`.reel*` into
   `src/ui/StoryPanels.css`, each imported by the module that owns it. Vite
   emits them as sibling chunks and resolves the dynamic import only once the
   stylesheet has landed. Eager CSS fell 23.9 → 20.1 kB.

   The shared shell — `.modal`, `.modal__card`, `.modal__close` — stays eager,
   because the settings and wardrobe panels use it too. Only the `--reel`
   variant travels.

   **A panel whose CSS is lazy must not be revealed before its chunk lands.**
   `HUD.openMap` used to unhide first and fetch afterwards, which was free
   while the CSS was eager and became a flash of unstyled markup the moment it
   was not. It now reveals in the `.then()`, and `mapWanted` tracks the
   player's intent separately from `mapOpen`, which tracks what is on screen.
7. **The stylesheet has a budget** (24 kB), currently at 20.1 kB after the
   split. Anything substantial from §4 should follow the same pattern rather
   than growing the eager sheet.
