# Phase 3 report — Life clock, aging, modes, and durable saves

**Status: PARTIAL.** The systems are built and tested; two of them are not yet
consulted by the running game. This document says which is which, per
criterion, because a report that rounds partial work up to "done" is worse than
no report.

**Date:** 2026-08-06
**Base:** `main` at the Phase 2 work (`646cd35`)
**Gate:** `npm run verify` green — **272 tests**, up from 179.

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

1. **SaveService is not wired into `Game`.** No autosave on birthday, no load
   on start, no save-status indicator in the HUD. The service is complete and
   tested; nothing calls it yet.
2. **No mode selection in the main menu.** `GameMode` exists and saves carry
   it, but there is no screen to pick Story or Free Roam, and no Free Roam
   setup (starting age, money, vehicle, zones, ageing speed).
3. **Gates are not consulted by `travelTo`.** `canEnterZone` is implemented and
   tested but `Game.travelTo` does not call it, so the city is currently
   reachable regardless of age or chapter.
4. **Birthday side effects are stubs.** The flow pauses, toasts and
   acknowledges. Autosave, appearance stage, NPC milestones and age-gated story
   checks are marked in the code and not implemented.
5. **`saveMigration` and `photoMode` blocks are never set** by the game — the
   clock supports them, nothing raises them yet.
6. **Safe spawn fallback on a missing chunk is untested end-to-end.**
   `SpawnRegistry` already degrades and is unit-tested from Phase 2, but no test
   loads a save whose `spawnId` has since been removed.

---

## 3. Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | 60 active minutes produces exactly one birthday | **Met** — unit-tested and verified in-engine: age 15 → pending 16 → settled 16 |
| 2 | Refreshing restores age and state without duplicate events | **Partially met** — `LifeClock.restore` is tested for exactly this, but `SaveService` is not wired in, so a refresh does not actually restore yet |
| 3 | No offline aging | **Met** — verified in-engine: hidden tab reports blocked `['hidden']` and year progress does not move |
| 4 | Story and Free Roam saves cannot be mixed | **Met at the service level** — `load` refuses a mode mismatch, both directions tested. No mode-selection UI exists to reach it |
| 5 | A corrupted autosave recovers from a valid backup | **Met** — tested, including automatic fallback and explicit `recoverFromBackup` |
| 6 | City access through typed gates, not scattered conditionals | **Partially met** — gates implemented and tested, but `travelTo` does not call them yet |
| 7 | `PHASE_03_REPORT.md` and a save schema reference | **Met** — this and `SAVE_FORMAT.md` |

**Three fully met, three partial, one not applicable.** The pattern is
consistent: the logic is built and tested, the integration into the running game
is where the gap sits.

---

## 4. Recommended next step

Wire `SaveService` into `Game`, in this order:

1. **Autosave on birthday**, inside the existing `handleBirthday` pause — the
   clock is already stopped there, which is exactly the safe moment.
2. **Load on start**, with `SpawnRegistry` resolving `spawnId` so a removed
   spawn degrades instead of stranding. That closes criterion 2 and gives
   criterion 6's test something to load into.
3. **Call `canEnterZone` from `travelTo`**, which closes criterion 6 and makes
   the city gate real rather than declared.

Then mode selection, which is UI work and can follow.

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
