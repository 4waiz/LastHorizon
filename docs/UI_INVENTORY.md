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
| Flight assist (assisted / reduced) | `FlightModel`; **no UI yet** |
| Per-need toggles ×4, needs speed | Settings → Needs |
| Reduced motion | OS media query **and** `:root.is-reduced-motion` |
| Safe-area insets | Token-level, all panels |
| Heat readout has an `aria-label` | `HUD.setHeat` |
| Touch controls with press *and* release | `.touch__act` |

---

## 4. What the Phase 11 brief asks for that does not exist

Listed plainly, because a component inventory that omits the gaps is a
marketing document.

**Screens not built:** Story Mode / Free Roam selection · three save slots and
autosave status · character name and appearance setup · pause menu · dedicated
accessibility panel · controls **remapping** · inventory and equipment ·
jobs and tasks · relationships and contacts · vehicle garage · apartment and
property · dedicated credits *screen* (credits currently live inside the info
modal).

**Systems not built:** the in-game phone · minimap upgrade (streamed zones,
filters, police search area, owned vehicles) · photo mode · birthday postcard
export · UI sound set · audio buses, ducking and gain staging · story stingers.

**Accessibility not built:** full remapping · touch layout editor · subtitles
and text speed · font scaling wired to `--ui-scale` · high-contrast prompts ·
colour-independent Heat and quest indicators · hold/toggle alternatives ·
aging speed selection · driving assist · flight assist UI.

**Reachability gap (criterion 1):** the systems added in Phases 9 and 10 are
partly unreachable from the interface. Weapons, Heat and arrest have HUD
readouts but no inventory or record screen; flight has no UI at all beyond the
test bridge; the six new activities have no jobs board.

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
   `MapPanel` since Phase 6, `StoryPanels` since Phase 8, both moved out of
   `HUD` when the app-chunk budget refused them.
6. **The stylesheet has a budget** (24 kB) and it is currently at 23.9 kB.
   Anything substantial from §4 needs that raised with a reason, or something
   moved.
