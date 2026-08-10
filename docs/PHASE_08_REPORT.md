# Phase 8 report — Story mode, quest graph, dialogue, choices and the Life Reel

**Status: the authored story is complete and reaches an ending on a legal route
and on a criminal one, both proved on every commit.** Fifteen main missions,
twenty side tasks, fifteen conversations, nine cutscenes and thirteen endings.
What is *not* done is in §8 and §9 rather than rounded away: three of the
fourteen objective kinds are declared and unauthored, the twenty side tasks are
not yet offered by anybody, the city districts still have no doors for the story
to point at, and the reel's "property" section knows about two kinds of home.

**Date:** 2026-08-10
**Base:** `phase-07-services`
**Gate:** `npm run verify` green — **1,251 unit tests**, up from 1,169;
**92 Playwright scenarios**, up from 81
**Branch:** `phase-06-population`

---

## 1. Phase 7 was verified first, and it was green

The instruction was to confirm Phase 7 before starting, and running the gate
rather than reading the report is the only way to do that. It held: typecheck,
lint, **1,169 unit tests across 46 files**, build, and all eleven budgets
inside their limits. The report's numbers matched the repository's exactly.

That is two phases in a row. Phase 5's did not — its report was accurate and
silent about the commit that came after it, which put the app chunk over.

---

## 2. The story is data, and the runtime is small

The shape follows `TaskSystem`, deliberately, because the argument is the same.

`QuestSystem` **reads no clock and touches no DOM.** Seconds arrive through
`advance(dt)`; age, money, mode and relationships arrive through a host. So a
seven-chapter story is walked start to finish in about a millisecond, and
`storyContent.test.ts` does exactly that on both routes on every commit —
which is the unit-level form of acceptance criterion 1.

Three rules shape the definitions, and each is a bug already paid for
elsewhere in this repository:

1. **No logic in the content.** A stage *names* a condition; it never evaluates
   one. There is one evaluator, so there is one place to look when a branch
   takes the wrong turn.
2. **Every reward is keyed** — `quest:<id>:<stage>:<reward>` — and the key set
   is in the save. Phase 7 learned that an idempotency key has to identify the
   *completion* rather than the job.
3. **Text is a key, never a string.** `strings.ts` is the only file in
   `src/story/` with a sentence in it.

### Quests are not tasks, and the split is load-bearing

A quest is a one-off with a place in the story and a stage the save remembers
forever. A task is a shift you can do again tomorrow. Sharing one system means
either repeatable chapters or jobs you can only do once.

They meet at exactly one point: a `work_shift` objective completes when
`TaskSystem` reports a finished run. Chapter 2's "work a shift" is a *real*
grocery shift with real difficulty scaling — not a story-shaped imitation of
one.

### Several quests run at once; one task does

`TaskSystem` holds a single slot on purpose. `QuestSystem` holds a map: a side
task taken from a neighbour must not be cancelled by the main story moving on,
and the main story must not wait for it.

---

## 3. What shipped

| System | Source | Test file | Tests |
| --- | --- | --- | --- |
| Quest model, conditions, consequences | `src/story/QuestDefinition.ts` | `questSystem.test.ts` | 29 |
| Runtime: stages, branches, rewards, retry | `QuestSystem.ts` | ” | ” |
| The save-facing state | `StoryState.ts` | ” | ” |
| 15 main missions | `mainStory.ts` | `storyContent.test.ts` | 25 |
| 20 side tasks | `sideStory.ts` | ” | ” |
| 7 chapters, the index | `storyCatalog.ts` | ” | ” |
| 3 ending families, 13 variants | `Endings.ts` | ” | ” |
| ~460 localisation keys | `strings.ts` | ” | ” |
| 15 dialogue trees | `dialogueCatalog.ts` | `storyPresentation.test.ts` | 26 |
| Conversation runtime | `DialogueRunner.ts` | ” | ” |
| 9 cutscenes and the player | `Cutscenes.ts` | ” | ” |
| The Life Reel | `LifeReel.ts` | ” | ” |
| The only thing that drives it | `StoryDirector.ts` | *(driven in-browser)* | — |
| The three panels | `src/ui/StoryPanels.ts` | *(driven in-browser)* | — |
| The content gate | `storyValidation.ts`, `scripts/check-story.mjs` | *(both)* | — |

### The content, against the brief's targets

| Asked for | Shipped |
| --- | --- |
| 10 main missions | **15** |
| 18 side tasks | **20** |
| 14 objective kinds | **11 authored**, 3 declared and unused (see §8) |
| 3 ending families | 3 families, **13 variants** |
| Short in-engine cutscenes, no video | **9**, all skippable, all ≤ 30 s |

### Phase 6 had already written the cast

Every one of the twenty named residents carries `questRoles` declared in Phase
6 — `chapter1_keepsakes`, `bicycle_repair`, `chapter6_law_route`,
`chapter7_letter` — a phase before there was a quest system to spend them on.
The side tasks are attached to those roles rather than to new people, and the
main story's cast is the village that already existed.

Nothing in phases 1–7 changed shape to accommodate this one, which is the real
test of whether those seams were in the right places.

---

## 4. Nine bugs, and where each was found

Two came from unit tests, two from browser runs, one from reading the save
schema, one from a validator written after the content, and **three from
reading the wiring back against the objective list** — which is the
uncomfortable number, because those three were the ones that made the game
unfinishable and no test written before them could have caught any of them.

Eight are Phase 8's. The ninth is a Phase 7 test that had always been
order-dependent and only failed once this phase moved the opening frames.

### The event queue stopped draining during a cutscene

The one that mattered. `StoryDirector.update` returned early while a scene was
playing — correct for stage timers and travel checks, since the player has no
controls — but it also skipped the event drain. A quest that *completed* during
its own scene left the `completed` event in the queue forever.

Chapter 7 ends on a scene. So **every run finished with a blank ending card.**

Every unit test passed: `QuestSystem` queued the event correctly and
`StoryDirector` handled it correctly. What was wrong was the order of two lines
in a frame, and only the browser run showed it.

### Skipping a cutscene during its own fade deadlocked the stage

`play()` built its completion promise *after* two `await fade()` calls. A scene
skipped in that window called `stop()` while `finished` was still null, so
nothing ever resolved it and whatever awaited the scene hung for good. Control
is now taken and the promise built before the first await — which also stops
the player walking off during the fade-in.

Found by a unit test that timed out rather than failed, which is its own kind
of signal.

### The rich criminal got the business ending

`stay_rise` ranked `magnate` above `wanted`, so a player who was rich,
resented *and* marked was handed "The Office". In that family the money and
the record are the same story and the record is the one that names it. Reordered.

Caught by a test written to check that the ending reads the law record at all.

### Three objective kinds had no reporter at all

The worst of the set, and all three were found by reading the wiring back
against the objective list rather than by any test — because the tests that
walk the story report objectives *by id*, which bypasses exactly the layer that
was missing.

`deliver`, `park` and `escape` were authored, validated and completable only
through the test bridge. In a real game, **chapter 1 could not be finished**:
"take the bread to Gita" waits on a `deliver` report and nothing sent one.
Chapter 6's crime route had the same hole at `escape`.

- **`deliver`** now completes when the player is at the place *holding the
  item*, and the item is actually handed over — a parcel you keep is a parcel
  you did not deliver. Done in the frame rather than at a counter, because most
  drops are somewhere with no counter at all.
- **`escape`** measures distance from wherever the stage started, recorded on
  the first check rather than on stage entry, since a stage can be entered in
  another zone.
- **`park`** is below.

The lesson is the one the interaction system learned in Phase 4 and the
`collect` objectives learned in Phase 7: **an end-to-end test that reports by
id proves the graph, not the game.** The browser route runs are still worth
having — they caught the cutscene event bug — but they cannot catch a missing
reporter, and nothing in this phase's test suite could have. That gap is
recorded in `docs/TEST_STRATEGY.md`.

### "Park in the bay" completed by walking into the bay

Found by reading the code back rather than by a test, which is worth admitting.
The travel check handled `travel` and `park` the same way — proximity — so
strolling into the parking bay on foot satisfied chapter 3's parking objective
and the dock task's. Parking is not standing somewhere; it is *leaving a
vehicle* somewhere.

`park` now reports from `Game.exitVehicle` on a successful exit, and it is
measured **from the vehicle** rather than from the player, because you can step
away from a correctly parked van.

### The escape objective asked for more ground than the village has

Chapter 6's crime route wanted 70 m of separation. It was written as 120, and
the browser test that measured it could only ever produce 81 — because the
village is about 119 m corner to corner (the far house to the shore bench), so
120 m from a field in the middle of it does not exist.

An objective that cannot be satisfied by any play, on the one route that also
has a 180-second fail timer, would have looped a player through the checkpoint
forever. Found by writing a test that actually walked the distance rather than
reporting it.

### Five objectives pointed at places that do not exist

Added late, and it should have been there from the start. Quest objectives name
a *place*; the validator checked npc ids and task ids against their catalogues
and never checked places against anything. Five were wrong —
`apartment_bed`/`apt_bed`, `apartment_decor`/`apt_decorate`,
`apartment_desk`/`apt_desk`, a `cafe_table` that never existed, and an
`apartment_door` that is a door rather than a point.

Each would have sat there forever. `matches()` needs a report naming the same
string, and nothing would ever send one — a silent, unwinnable objective is
about the worst failure a quest graph has, and it is invisible to every test
that does not walk the *world*.

The check now resolves a place against all three sources it can legitimately
come from. The `apartment_door` objective was deleted rather than repaired:
"get to the apartment" is implied by "sleep there once", and an objective
another objective implies is a HUD line doing no work.

### An interior budget test that had always measured its first room cold

The last one, and it is not a Phase 8 defect — it is a Phase 7 test that was
latently order-dependent, and Phase 8's lazy story import shifted the opening
frames enough to expose it.

`interiorBudget.spec.ts` walks all nine rooms and asserts, among other things,
that the spread of shader programs across them is at most 2 — the guard on the
lighting-configuration trap Phase 7 found. But `renderer.info.programs` counts
what has *compiled*, and the first room entered on a fresh page has not yet
compiled everything the later ones will need. Measured cold, `home` reported
**50 programs against the 53 every other room reports** — a spread of 4, and a
failure about nothing at all. On the retry it reported 53 and the spread was 1.

This is the identical trap Phase 7 wrote up for its *leak* test — "warmed up on
one room and measured nine" — and did not apply to this one. The spec now takes
a cheap warm-up lap through all nine before the measured lap. Lap two is the
honest lap, which is a principle already in `docs/TEST_STRATEGY.md` and was
simply not applied here.

**With the warm-up, the spread is 0.** Every one of the nine compiles to
exactly 54 programs, which is the strongest confirmation available that the
variance was cold-start compilation and not a lighting difference — the thing
the assertion exists to catch is still caught, and it has stopped reporting a
difference that was never there. The draw calls and triangles came down 2–3 and
~1–2 k respectively for the same reason: nothing is still being built while it
is being counted. `docs/PERFORMANCE_BUDGETS.md` carries the corrected table.

### The save schema restated a type instead of borrowing it

`StoryProgressData` was written out by hand with `kind: string` where the reel
has a `ReelEventKind` union — the identical mistake `EconomySaveData` made in
Phase 7, in the identical place, one phase later. It now imports `StoryState`'s
own shape. One definition cannot drift from the thing it describes.

### And two tests that were wrong rather than the game

Worth recording because the reflex is to change the code.

**A dialogue line that was supposed to be locked was not.** The test asserted
Maryam's bolder line needed trust the player had not earned at sixteen. Phase 6
seeds her `initialRelationship` at trust 0.4 — because the player grew up in
her shop, which is deliberate characterisation. Changing the game to satisfy
the test would have deleted it. The test moved to the age gate on chapter 6's
crime route: it does not depend on a seed, and "a seventeen-year-old is not
offered the crime route" is the more important rule anyway.

**A save test tried to fake three keepsakes.** The frame overwrote it every
time, because `collect` objectives are re-read off the world on purpose — the
truth of "you have found three" is how many you have found. The test moved to
chapter 6's `exploit` stage, whose objectives are not world-derived, and in
doing so became a better test: it now proves a reward already in the save does
not pay a second time.

---

## 5. Budgets

**120.5 kB of new code. 17.8 kB of it reaches the loading screen.**

| | Phase 7 | Phase 8 | Budget |
| --- | --- | --- | --- |
| app chunk | 351.1 kB | **363.2 kB** | ≤ 375 kB *(was 360)* |
| `StorySubsystem-*.js` *(lazy)* | — | **108.4 kB** | — |
| JS total (startup) | 1,091.5 kB | 1,103.6 kB | ≤ 1,120 kB *(was 1,100)* |
| stylesheet | 17.9 kB | 20.8 kB | ≤ 24 kB |
| **initial load** | **4,168.7 kB** | **4,186.5 kB** | **≤ 4,200 kB** |
| shipped total | 7,349.1 kB | 7,473.8 kB | ≤ 7,600 kB *(was 7,400)* |

The split follows the line Phase 7 drew for interiors: **what does the save
layer touch on the first frame?**

- **Eager, 11.6 kB.** `StoryState` — flags, choices, two reputation numbers,
  the reel and quest positions — plus the wiring in `Game` that reports world
  events into it. `SaveService` reads and writes all of that whether or not a
  quest has ever loaded.
- **Lazy, 108 kB.** The catalogue, the trees, the scenes, the endings, the
  string table, the reel renderer and the three panels. Reached only when
  Story Mode starts, behind the mode selector's own loading screen. A Free
  Roam player never fetches a byte of it.

**Two things were moved rather than absorbed.** The catalogue was always going
to be lazy. The three Story-Mode panels were written inside `HUD` and moved out
to `src/ui/StoryPanels.ts` *because this gate said no* — the app chunk hit
365.2 kB against a 360 kB limit, and the rule here is to move something before
raising a ceiling. `MapPanel` was moved for the same reason in Phase 6. It
recovered 2.5 kB and left a better boundary: `HUD` is the chrome that is always
on, and a conversation is not.

The remaining 2.7 kB is the wiring itself and cannot be split — it is reached
from the first frame by definition. Hence 360 → 375, with ~3% headroom, which
is deliberately tight for the same reason every previous raise was.

`check-budgets.mjs` gained `StorySubsystem-` in `LAZY_CHUNK_PREFIXES`. Without
it the gate counted 108 kB of story as startup weight and failed four budgets
at once, which is the gate working.

### Scene cost

Zero. Nothing in this phase adds a draw call, a triangle or a shader program:
the quest system is arithmetic, the panels are DOM, and a cutscene moves the
camera that already exists over the world as it already stands. The interior
and outdoor figures from Phase 7 are unchanged and `interiorBudget.spec.ts`
still holds them.

The one per-frame addition is the travel check, and it runs at **4 Hz** rather
than per frame — far more often than anybody walks six metres, and off a hot
path where the occlusion raycast is still the largest item.

---

## 6. Against the acceptance criteria

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | The full main story is completable from a fresh save without debug commands | **Partially met, and stated as such.** See below. |
| 2 | At least one fully legal route and one mixed/criminal route reach valid endings | **Met.** The two browser runs are exactly these. The legal route takes chapter 6 through the law and lands in `return_build`; the mixed route takes the dock shortcut and the survey pegs and lands in `stay_rise`. Each asserts it visited the stage it claimed. |
| 3 | Saving at any quest stage and reloading cannot duplicate rewards or lose objectives | **Met.** In the browser: a stage half done, saved, and restored with the same objective still undone; the $900 commission paid once, saved *after* payment, then the stage re-entered and completed again — the wallet does not move, because the award key is in the file. `questSystem.test.ts` covers the same ground at the unit level, including a grant that fails and correctly *releases* its key so the reward can pay later. |
| 4 | Free Roam is not blocked by story gates | **Met.** A dedicated browser scenario picks Free Roam through the real mode selector, then asserts the story never loaded, no quest is active, and doors, money and jobs all still work. The story chunk is not fetched at all in that mode. |
| 5 | Life Reel accurately reflects choices and can export an image locally | **Met.** The reel model is pure and unit-tested against recorded choices, ordering, the law record in words, and locale-independent money. In the browser it renders, exports a real PNG of >1 kB, and the scenario watches every non-`GET` request and asserts there were none. |
| 6 | `docs/PHASE_08_REPORT.md`, a quest map, and a spoiler-separated narrative guide | This document, [QUEST_MAP.md](QUEST_MAP.md) and [NARRATIVE_GUIDE.md](NARRATIVE_GUIDE.md). |

### Criterion 1, honestly

It is met in two pieces and **not** as one continuous played run, and the
distinction matters enough to spell out rather than round up.

**What is proved.** The *graph* completes: `storyContent.test.ts` walks all
fifteen main quests to the end on three different choice sets — including one
with no choices recorded at all, since every fork has an unconditional fallback
— and `story.spec.ts` does the same in a real browser on two routes, ageing
through the real gates, with an ending resolving at the end of each. Separately,
every objective *kind* is proved to have a working reporter: `deliver`, `park`
and `escape` by the scenario that does them for real, and `travel`, `talk`,
`interact`, `collect`, `buy`, `work_shift` and `drive` by this phase's and
Phase 7's browser tests.

**What is not.** The two route runs drive the graph with `reportObjective`,
which is a bridge operation — a debug command. So no single run plays the whole
story by *doing* every objective. Given that three reporters were missing
entirely until they were found by hand, that gap is not academic, and claiming
criterion 1 outright would be claiming the thing that hid them.

Closing it means a much slower browser run that genuinely carries the bread,
works the shift and rides the bicycle. It is the right next thing for this
suite and it is recorded in `docs/TEST_STRATEGY.md`.

Two of the brief's other constraints are **enforced rather than observed**:

- **The story never requires violent crime.** `storyValidation` fails the build
  if any `main` quest carries a `combat` objective, and `storyContent.test.ts`
  asserts it independently. Chapter 6 offers five routes and four are legal;
  a test asserts that count directly, so an edit that made crime the only way
  out fails rather than ships.
- **No runtime generative dialogue.** Every line is authored and in
  `strings.ts`. Nothing in `src/story/` makes a network call.

---

## 7. Verification

**Unit:** 1,251 tests across 49 files. Three new files, 80 new tests, plus two
save-migration tests for v3 → v4.

**Content:** `npm run check:story` — clean across 35 quests, 15 dialogue trees,
9 cutscenes and 13 endings. It earned its place twice:

- **120 missing strings** the first time it ran, which is exactly what it is
  for, and no structural issue at all — no cycle, no unreachable branch, no
  duplicate reward, no dangling target.
- **Five objectives naming places that do not exist**, once a place check was
  added late: `apartment_bed` where the interior catalogue says `apt_bed`, an
  `apartment_door` that was never a point, and a `cafe_table` that was never a
  thing. Each would have been an objective that could *never* complete, because
  nothing would ever report a name nothing has — the exact "invalid objective
  targets" failure the brief asks for, which the first version of the validator
  did not look for. The check now resolves every `place` against the three
  places one can legitimately come from: `STORY_PLACES`, an interior's own
  point ids, and the task catalogue's names.

**Browser:** 92 scenarios across 11 specs, green in Chromium in **18.4 minutes**
against the production build, no failures and nothing flaky.
`story.spec.ts` contributes 11: the story loading lazily, putting an
objective on the HUD and opening the journal with **J**; both full routes; the
save/reload pair; Free Roam untouched; an authored conversation opening a real
panel and recording its choice; the crime route offered and refused at fifteen;
a cutscene running, skipping and handing the camera back; the reel exporting a
PNG with nothing leaving the device; the ending varying with the state; and
`deliver`, `park` and `escape` completed by doing them rather than reporting
them, which is the one that found three missing reporters.

**Commands run:** `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `npm run check:budgets`, `npm run check:story`,
`npx playwright test --project=chromium`.

---

## 8. Remaining risk

- **Three of the fourteen objective kinds are not authored.** Eleven are in
  play: `talk` (44 uses), `interact` (22), `travel` (14), `buy` (9),
  `work_shift` (7), `deliver` (7), `collect` (7), `wait` (5), `drive` (4),
  `park` (2), `escape` (1).
  `photograph` needs photo mode (Phase 11) and `combat` needs weapons (Phase
  9); both are declared so content *can* reference them and the validator can
  check them, both are in `OBJECTIVES_AWAITING_SYSTEMS`, and the validator
  **fails** any quest that uses one — so nothing authored can quietly depend on
  a system that is not there. `follow` is fully implemented and validated and
  simply nothing uses it, which makes it the one kind with no coverage from
  content.
- **The city districts still have no doors**, carried from Phase 7. Chapter 4
  onward points at interior places that only resolve in the village; the
  objectives still complete, because `interact` reports come from whichever
  room is open, but a player in Downtown has fewer buildings than the fiction
  implies.
- **Cutscenes stage nothing.** They move the camera over the world as it
  stands. A scene cannot pose the cast, because fetching four residents from
  wherever their schedules put them is a teleport the player watches happen.
  It is a real ceiling and it is why the shot lists point rather than perform.
- **Portraits are an initial in a disc.** A portrait system needs art nobody
  has drawn, and a coloured initial is legible at 34 px where a 5k-triangle
  head is not. Phase 11 owns it.
- **Dialogue history is a list, not a transcript.** It records what was said
  and what you replied; it does not survive leaving the conversation.
- **One locale.** `t()` falls back to the key, the table is the `en` table, and
  adding a second is another table and a lookup order. Nothing above
  `strings.ts` would change — but nothing has proved that yet.
- **The browser suite is longer again.** 91 scenarios, and the two full-route
  runs are the most expensive things in it. Phase 6 flagged sharding as the
  answer when this next hurt; Phase 7 said it was closer; it is closer still.
- **`chapter_7` never lands in `completedChapters`.** The other six chapters
  are completed by a consequence on the quest that closes them; chapter 7 ends
  the *story* instead, and resolves an ending. Nothing reads the flag — `Gates`
  only cares about `village_departure` — so this is a cosmetic gap in a list
  rather than a behaviour, and `storyContent.test.ts` names it as the one
  documented exception rather than quietly skipping it.
- **The journal is behind J and nothing else.** No touch button, no gamepad
  binding, no pause menu. Phase 11 owns the full interface pass; until then a
  phone player can see the objective line but not the journal.
- **A gamepad cannot drive dialogue.** The brief asks for controller and touch
  support on the dialogue system. Touch works — the choices are real `<button>`
  elements and a tap is a click — and so does keyboard, including focus landing
  on the first pressable option. A pad does not: `GamepadReader` moves the
  character and takes interactions, and nothing navigates the DOM with it. That
  is a general gap rather than a dialogue one — no panel in this game is
  pad-navigable — and it belongs with Phase 11's interface pass rather than
  with a one-panel workaround here. Stated rather than rounded up.

---

## 9. What is not done

Listed rather than rounded away.

- **No photo objectives and no combat objectives.** As above.
- **The reel's property section knows two homes** — the apartment and the
  family home. There is no property system beyond those, so there is nothing
  else for it to list.
- **A half-played cutscene is not saved.** Deliberate, and the same argument
  Phase 7 made about a half-finished shift: restoring a conversation
  mid-sentence is worse than reopening it.
- **No chapter select.** `jumpToStage` exists and is test-mode only, on
  purpose — it is the one bridge operation that can skip authored content. A
  player-facing chapter select is a menu, and menus are Phase 11.
- **Side tasks are not offered by anyone yet.** All twenty are authored,
  validated and startable, and the thing that would hand one to you is an NPC
  conversation offering it — `offersTask` exists on the dialogue choice type
  and nothing sets it. That is a wiring job in `StoryDirector`, not a content
  one, and it is the first thing to do next.
- **No credits screen.** The brief mentions "after credits, offer continued
  Free Roam". The *state* for that is done — the ending resolves, the reel
  renders, and ageing rate is already a typed setting with 30/60/120/frozen —
  but there is no credits sequence to come after. Phase 11 owns the screen.

---

## 10. Next safe phase

Phase 9 — adult combat, weapons, crime witnesses and police heat. It attaches
cleanly and in two places that were built for it:

- `Perception` has emitted witness events since Phase 6, with distance, field
  of view, occlusion and hearing, and no code path that can hand police a
  position nobody saw.
- The story's `law` reputation is already the thing an ending reads, and
  chapter 6's crime route already moves it by −0.45. Phase 9 supplies the
  *live* consequence — Heat, pursuit, arrest — where this phase supplies the
  history.

Two things worth doing before it, both small and both this phase's own debt:

1. **Wire `offersTask`** so residents hand out the twenty side tasks. They are
   written, validated and startable, and not one of them is reachable in
   ordinary play. It is the one number this phase moved in the wrong direction.
2. **A browser run that plays rather than reports.** Criterion 1 is met in two
   pieces and not as one continuous run, and three missing reporters hid behind
   exactly that gap. It will be slow — carrying bread across a village in real
   frames — and it is the only thing that would have caught them.
