# Controls

*A Kanban Studios game — kanbanstudios.ae. Game Developer: Awaiz Ahmed.*

Read out of `src/core/InputManager.ts`, `src/ui/HUD.ts` and the controls panel
in `index.html`, not from memory. Where this document and the game disagree,
the game is right and this is a bug.

---

## On foot

| | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | **W A S D** / arrows | Left stick | Left joystick |
| Run | **Shift** | Left stick click | **RUN** |
| Jump | **Space** | A / cross | **JUMP** |
| Look | Drag mouse | Right stick | Drag the right half |
| Zoom | Scroll wheel | — | Pinch |
| Interact | **E** or **F** | A / cross | **USE** |

Interact is contextual: doors, beds, chairs, wardrobes, shop counters, vehicle
seats, people. When more than one thing is in reach you get a small selector
rather than the wrong object.

**A door ignores which way you are facing.** Everything else does not. A
threshold you cannot use from behind leaves people standing outside their own
house; a bed behind you is not something you meant to climb into.

## Panels

| Key | Opens |
| --- | --- |
| **M** | Map |
| **J** | Journal — the story, its stages and what is outstanding |
| **P** | Phone — work, people, garage, and the map and journal again |
| **R** | Pause, and the three save slots |
| **Esc** | Closes whatever is open |

The ⓘ tile, top right, holds settings, needs, accessibility, the controls
reference and the credits.

## Driving

| | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Accelerate | **W** | Right trigger | Right pedal |
| Brake / reverse | **S** | Left trigger | Left pedal |
| Steer | **A** / **D** | Left stick | Tilt or on-screen wheel |
| Handbrake | **Space** | A / cross | **HAND** |
| Get out | **E** | B / circle | **USE** |

The camera pulls back with speed and swings round for reverse. A bicycle and a
scooter balance themselves at low speed — you do not have to fight them.

## Flying

Assisted mode is on by default and is the mode the game is balanced around: it
levels the wings when you let go, limits how far you can bank or pitch, pushes
the nose down before it can stall, and **flares for you on landing**. Reduced
assist is in the accessibility panel.

| | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle | **W** / **S** | Triggers |
| Pitch | Mouse or arrows | Right stick |
| Roll | **A** / **D** | Left stick |
| Rudder | **Q** / **E** | Shoulder buttons |
| Wheel brakes | **Space** | A / cross |

## After eighteen, and only if you want to

None of this is required. The story can be finished, on every route, without
drawing a weapon — and one of the two automated end-to-end runs proves that on
every commit.

| Key | |
| --- | --- |
| **Q** | Draw or holster |
| **1** – **4** | Choose what you are holding |
| Right mouse | Aim |
| Left mouse | Fire |
| **G** | Reload |
| **V** | Swap shoulder |

## Accessibility

In ⓘ → Accessibility, and all of them persist:

| Option | Values |
| --- | --- |
| Text size | 0.85 / 1 / 1.3 / 1.6 — scales the whole interface |
| Motion | Match system / full / reduced |
| High-contrast prompts | On / off |
| Heat as a numeral | On / off — a third channel beside position and colour |
| Flight assist | Assisted / reduced |

In ⓘ → Action: aim assist, camera shake, flashes (photosensitivity), and
combat difficulty. In ⓘ → Needs: each of the four needs on or off, and their
speed at off / half / normal.

**Ageing speed** is chosen when you start a Free Roam run — 30, 60 or 120
minutes per year, or frozen. Story Mode uses 60.

## What is not here, and is honest about it

- **No key remapping.** The bindings above are fixed. This is the largest
  accessibility gap in the release and it is in
  [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
- **A gamepad does not navigate menus.** It moves the character, drives,
  flies and takes interactions. It does not move focus through a panel — no
  screen in this game is pad-navigable, so dialogue choices, the phone and the
  save slots need a keyboard or a touch screen.
- **No touch layout editor.** The on-screen controls are where they are.
