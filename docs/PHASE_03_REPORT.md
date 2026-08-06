# Phase 3 report — Life clock, aging, modes, and durable saves

**Status: all seven acceptance criteria met.** Parts of the *phase description*
beyond those criteria are not built — Free Roam's setup options, the birthday's
appearance/NPC/story side effects, and a save-status indicator. Those are listed
in §2 rather than rounded away.

**Date:** 2026-08-06
**Base:** `main` at the Phase 2 work (`646cd35`)
**Gate:** `npm run verify` green — **275 tests**, up from 179.

---

## 1. Built and verified

### Three independent clocks (`src/core/clocks/`)

| Clock | Owns | Runs on |
| --- | --- | --- |
| `LifeClock` | Age, birthdays | Active play seconds, gated |
| `WorldClock` | Day/night scalar, day count | Its own fixed day length |
| `StoryClock` | Chapter time, quest countdowns | Active seconds |

**Not derived from one scalar, and there are tests for why.** Deriving age from
the day/night scalar would tie "lock the sky to dusk" to the character's
lifespan; running quest deadlines off `LifeClock` would let a player halve every
deadline by choosing 30 minutes per year. Both are asserted directly.

`LifeClock` details that matter:

- **Activity gating is a set, not a boolean.** `hidden`, `paused`, `loading`,
  `settings`, `saveMigration`, `photoMode` and `birthday` can hold at once —
  a hidden tab during a save migration, say — and each must release
  independently or the clock stays stuck. There is a test for that exact case.
- **A birthday pauses progression until acknowledged.** That is what makes
  "pause, autosave, show the postcard, apply unlocks" possible without the next
  birthday racing it.
- **Overflow is carried, not discarded.** A long stall past a boundary keeps the
  excess and delivers the next birthday on acknowledgement, so a leap across
  several years neither loses play time nor fires them all at once.
- **`lastHandledAge` is what stops replay.** A save that closed mid-birthday
  re-arms it once; a completed one never fires again.

### Typed gates (`src/core/Gates.ts`)

Every gated capability is a named union member, so a new gated system cannot
quietly default to allowed, and every decision returns a **player-facing
reason** the UI can render instead of inventing its own copy of the rule.

- Adult gates (weapons, weapon shops, violent crime) check age alone and apply
  in **both** modes. Free Roam reaches them by letting the player pick a
  starting age, not by skipping the rule.
- City access needs age 18 **and** the village departure chapter in Story Mode.
  Free Roam has no chapters, so it honours the player's chosen zone unlocks —
  applying a story gate there would make the setup screen a lie.

### SaveService (`src/save/`)

Built around the failure that actually loses runs: a write interrupted halfway.
Write protocol, backup policy, migration and validation are documented in
[SAVE_FORMAT.md](SAVE_FORMAT.md).

Testable without an IndexedDB shim because the driver is an interface — which
also means write failures are injected *for real* rather than mocked at the
wrong layer.

### Wiring

`advanceClocks` runs every frame; life is blocked by hidden tab, pause,
transitions and the info/wardrobe panels. HUD shows a minimal age badge.
`__LH_TEST__` gained `advanceLife`, `forceBirthday` and `getLifeState`.

---

## 2. Not done

1. **Birthday side effects are stubs.** The flow pauses, announces, ages up and
   autosaves. Appearance stage, named-NPC milestone events and age-gated story
   checks are marked in the code and not implemented, because **none of those
   systems exists yet** — they arrive in Phases 4, 6 and 8.
2. **`photoMode` block is never raised** — the clock supports it, there is no
   photo mode to raise it. Phase 11.
3. **Only the autosave slot is reachable from the UI.** Three manual slots are
   implemented, tested and exposed on the test bridge; no menu writes or reads
   them. That is a load/save screen, which is Phase 11's job.

Everything above depends on a system a later phase builds. Nothing in Phase 3's
own scope is outstanding.

### Bugs found by running it, not by testing it

Worth recording, because all three passed the unit suite:

- The birthday autosave ran **before** `acknowledgeBirthday`, recording the
  pre-birthday state. A reload re-armed and re-fired the same birthday — the
  exact duplicate event criterion 2 forbids.
- A save written between reaching a birthday and acknowledging it restored with
  one still armed and **nothing ever delivered it**, leaving the clock blocked
  forever.
- `presetMode` is called during `start()`, which runs *before* `ready()` builds
  the mode row, so the "continuing a saved run" lock silently no-opped.
- The mode selector and Free Roam panel were **completely invisible** while
  passing every DOM assertion: the loading screen's painted background is
  absolutely positioned, so elements added in normal flow rendered behind it.
  Only the screenshot caught it. Both now carry an explicit stacking context.

---

## 3. Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | 60 active minutes produces exactly one birthday | **Met** — unit-tested, and verified in-engine: 15 → pending 16 → settled 16 |
| 2 | Refreshing restores age and state without duplicate events | **Met** — verified on a cleared database: three birthdays take 15 → 18, a reload restores **18** with no pending birthday, and settling 120 frames does not replay one |
| 3 | No offline aging | **Met** — verified: a hidden tab reports blocked `['hidden']` and year progress does not move |
| 4 | Story and Free Roam saves cannot be mixed | **Met** — `load` refuses a mode mismatch both directions (tested); the selector persists the chosen mode and **locks** on a resumed run |
| 5 | A corrupted autosave recovers from a valid backup | **Met at the unit level** — automatic fallback and explicit `recoverFromBackup` are tested. Not reproduced in a browser: corrupting IndexedDB by hand was not worth the risk to a working save |
| 6 | City access through typed gates, not scattered conditionals | **Met** — `travelTo` calls `canEnterZone`; verified refused at 15, still refused at 18 without the departure chapter, and allowed once both hold |
| 7 | `PHASE_03_REPORT.md` and a save schema reference | **Met** — this and `SAVE_FORMAT.md` |

**Seven met.** Criterion 5 is the one leaning on unit tests rather than an
in-engine reproduction, and the report says so rather than implying otherwise.

---

## 4. Recommended next step

The remaining §2 items are UI-shaped and can follow the next phase's needs. The
one worth doing before Phase 4 is the **Free Roam setup screen**, because every
field it sets — starting age, money, vehicle, unlocked zones, ageing rate —
already exists as typed state and is already saved. Leaving it unbuilt means
Free Roam is currently just "Story without the chapter gate", which is not the
mode the vision describes.

Phase 4 (player growth and animation layers) depends on the age stages this
phase produces, so the birthday's appearance-stage hook is the natural first
thing it wires into.

---

## 5. Carried forward from earlier phases

Unchanged and still open: Rapier and Recast integration, the traffic lane
runtime and the world debug overlay (Phase 2, deliberately deferred — see
[PHASE_02_REPORT.md](PHASE_02_REPORT.md)); the M-key map popup; and the
window/door wall openings, which need `boolean_diff` rather than offset changes.

**Repository hygiene, now actively costing time:** `node_modules` is tracked
(7,411 files). During this session it blocked a branch checkout twice and a
merge three times — a Vitest cache file, a file-locked `esbuild.exe`, and
untracked Vite chunks the merge wanted to overwrite. Killing the esbuild process
to clear that lock then left the dev server running on a dead transform service,
which surfaced later as a bogus 500. Worth one commit to untrack.
