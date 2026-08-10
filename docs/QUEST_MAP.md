# Quest map

The shape of the authored story: what depends on what, where it branches, and
which system each mission is actually about.

**No plot here beyond mission titles.** For what happens, see
[NARRATIVE_GUIDE.md](NARRATIVE_GUIDE.md), which is spoiler-separated.

Source of truth is `src/story/mainStory.ts` and `src/story/sideStory.ts`;
`npm run check:story` validates everything below.

---

## The spine

Fifteen main missions, in one line. Each `requires` the one before it, so the
prerequisite graph is a chain and `storyValidation` proves it has no cycle.

```
ch1  q1_keepsakes ──▶ q1_the_road
                          │
ch2                       ▼
     q2_first_pay ──▶ q2_deliveries ──▶ q2_the_bicycle
                                              │
ch3                                           ▼
     q3_road_test ──▶ q3_mentor ──▶ q3_the_crack
                                         │
ch4                                      ▼
     q4_departure ──▶ q4_first_key ──▶ q4_city_job
                                            │
ch5                                         ▼
     q5_a_name ──▶ q5_someone
                       │
ch6                    ▼
     q6_the_offer
          │
ch7       ▼
     q7_last_horizon ──▶ ending
```

## What each mission is for

The brief asks that a main mission introduce, combine or meaningfully test a
mechanic rather than act as filler. This is the accounting.

| # | Quest | Age | Puts under load |
| --- | --- | --- | --- |
| 1 | `q1_keepsakes` | 15 | Collectibles, interaction, first dialogue |
| 2 | `q1_the_road` | 15 | Shop counter, an item that moves, the bicycle |
| 3 | `q2_first_pay` | 16 | `TaskSystem` end to end, the economy, spending |
| 4 | `q2_deliveries` | 16 | Inventory + routes; first relationship-gated branch |
| 5 | `q2_the_bicycle` | 16 | Ownership, two routes to the same object |
| 6 | `q3_road_test` | 17 | Vehicle physics: distance *and* parking |
| 7 | `q3_mentor` | 17 | The first recorded choice the endings read |
| 8 | `q3_the_crack` | 17 | Travel + talk; plants chapter 6 |
| 9 | `q4_departure` | 18 | Zone travel, `village_departure`, the city gate |
| 10 | `q4_first_key` | 18 | Interiors, property, rent |
| 11 | `q4_city_job` | 18 | The timed courier job, the police desk |
| 12 | `q5_a_name` | 19 | Reputation branching; law record moves for the first time |
| 13 | `q5_someone` | 20 | Relationship axes as a four-way branch |
| 14 | `q6_the_offer` | 22 | Every axis at once, across five routes |
| 15 | `q7_last_horizon` | 25 | The ending resolver |

## Where it branches

Seven recorded choices. Each is written by a dialogue tree and read later by a
branch condition or by an ending.

| Choice id | Set in | Values | Read by |
| --- | --- | --- | --- |
| `ch2_bicycle` | `dlg_tomas_bicycle` | `buy`, `fix` | `q2_the_bicycle` stage select |
| `ch3_mentor` | `dlg_mentor_choice` | `trade`, `school`, `road` | Reel, flags |
| `ch5_route` | `dlg_omar_shortcut` | `straight`, `shortcut` | `q5_a_name` stage select |
| `ch5_someone` | `dlg_someone` | `sana`, `hana`, `noor`, `alone` | `q5_someone` branch, `stay_rise_alone` |
| `ch6_route` | `dlg_the_offer` | `protect`, `law`, `expose`, `exploit`, `crime` | `q6_the_offer` stage select |
| `ch7_home` | `dlg_last_horizon` | `return`, `stay`, `between` | Ending family |

`q3_mentor` also branches on `ch3_mentor` directly, ending the quest three
different ways.

### Chapter 6, in full

The one place five routes exist at once. **Four of the five are legal** — the
brief requires the story never to *demand* violent crime, and the honest way to
satisfy that is to make the lawful routes competitive rather than to bolt on a
token alternative.

```
                       q6_the_offer/weigh
                              │
        ┌───────────┬─────────┼─────────┬────────────┐
        ▼           ▼         ▼         ▼            ▼
     protect       law     expose    exploit       crime
   community+.30  law+.20  comm+.25  comm−.35    law−.45
                  comm+.15 law+.10   $900        comm+.10
        └───────────┴─────────┼─────────┴────────────┘
                              ▼
                          settled ──▶ chapter 6 complete
```

`undecided` is a sixth, unconditional branch that falls through to `protect`.
Every stage in this repository has an unconditional last branch; a stage whose
every branch is gated can complete with nowhere to go, and `storyValidation`
refuses one.

## Endings

Three families, thirteen variants. The family comes from `ch7_home`; the
variant from state the player never announced.

```
ch7_return ──▶ return_build   champion · witness · shadow · debt · quiet
ch7_stay   ──▶ stay_rise      wanted · magnate · respected · alone · working
(neither)  ──▶ live_between   bridge · courier · restless
```

Variants are ranked **most specific first** and the first match wins, so the
last in each family is unconditional and is what an ordinary run gets. The
inputs are the four the brief names: `law`, relationships, money, `community`.

Thresholds live in `src/story/Endings.ts`:

| Name | Value | Means |
| --- | --- | --- |
| `CLEAN_RECORD` | law ≥ 0.90 | nothing has dented it |
| `MARKED_RECORD` | law ≤ 0.45 | at least one route went sideways |
| `TRUSTED` | community ≥ 0.55 | standing that had to be earned |
| `RESENTED` | community ≤ 0.15 | the village would not have you back |
| `RICH` | $6,000 | ~two chapters of diligent work above living costs |
| `COMFORTABLE` | $1,500 | rent paid and something over |

## Side tasks

Twenty, all abandonable, all one-offs. A *repeatable* errand is a job and lives
in `src/tasks/` with difficulty scaling; these are small one-time favours.

| Chapter | Village | City |
| --- | --- | --- |
| 1 | `s_neighbour_errand`, `s_village_history`, `s_lost_camera`, `s_shore_catch` | — |
| 2 | `s_school_run`, `s_farm_hands`, `s_workshop_hands`, `s_noor_study` | — |
| 3 | `s_bike_rival`, `s_hill_lookout` | — |
| 4 | — | `s_market_stock`, `s_garage_hands`, `s_paperwork`, `s_cafe_shift` |
| 5 | — | `s_city_history`, `s_night_shift`, `s_petition`, `s_courier_chain`, `s_dock_cargo`, `s_ines_errand` |

Every one is attached to a named resident who already had a `questRole`
declared for it in Phase 6's catalogue — `neighbour_errand`, `bicycle_rival`,
`chapter6_witness` and the rest were written a phase before there was a quest
system to use them.

## Cutscenes

Nine, all skippable, all under thirty seconds — `storyValidation` enforces the
ceiling and `storyContent.test.ts` asserts every gesture named is a clip the
rig actually has.

| Scene | Stage | Anchor | Length |
| --- | --- | --- | --- |
| `cs_first_horizon` | `q1_keepsakes/bench` | `village_bench` | 7.5 s |
| `cs_the_road_out` | `q1_the_road/ride` | `village_junction` | 7.5 s |
| `cs_the_survey_peg` | `q3_the_crack/ask` | `village_field` | 7.0 s |
| `cs_leaving_the_village` | `q4_departure/pack` | `village_home` | 11.0 s |
| `cs_a_name_of_your_own` | `q5_a_name/known` | `om_square` | 7.5 s |
| `cs_the_letter` | `q6_the_offer/letter` | `apt_desk` | 7.0 s |
| `cs_what_the_road_costs` | `q6_the_offer/settled` | `village_field` | 9.0 s |
| `cs_the_last_horizon` | `q7_last_horizon/decide` | `village_hill` | 24.0 s |
| `cs_the_lookout` | `s_hill_lookout` | `village_hill` | 8.0 s |

## Objective kinds in play

Eleven of the fourteen the brief lists are authored, with these counts across
all 35 quests:

| Kind | Uses | Kind | Uses |
| --- | --- | --- | --- |
| `talk` | 44 | `collect` | 7 |
| `interact` | 22 | `wait` | 5 |
| `travel` | 14 | `drive` | 4 |
| `buy` | 9 | `park` | 2 |
| `work_shift` | 7 | `escape` | 1 |
| `deliver` | 7 | | |

Three are declared and unauthored. `photograph` needs photo mode (Phase 11) and
`combat` needs weapons (Phase 9); both are in `OBJECTIVES_AWAITING_SYSTEMS` and
`storyValidation` **fails** any quest that uses one — which is also what makes
"no main mission requires violent crime" a build failure rather than a promise.
`follow` is implemented and validated and nothing uses it.

## Places

An objective names a place; a place resolves from exactly three sources, and
`storyValidation` checks every one against all three:

1. **`storyPlaces.ts`** — outdoor anchors, mirroring the zone anchors
   `npcCatalog.ts` already uses for schedules, so a resident's "work" anchor and
   a quest's "go here" land in the same spot.
2. **An interior's own point ids** — `apt_bed`, `grocery_counter`,
   `garage_lift`. Their positions belong to the built room, not the world.
3. **The task catalogue's place names** — for objectives riding on a job.

That check was added after the content was written and immediately found five
objectives pointing at names that do not exist. Each would have been silently
uncompletable. Worth running before assuming a new place name works.

## Adding a quest

1. Write it in `mainStory.ts` or `sideStory.ts`, keys only, no sentences.
2. Add every key to `src/story/strings.ts`.
3. `npm run check:story` — it will name what is missing, including a place
   name or an npc id that does not exist.
4. If it closes a chapter, add the `completeChapter` consequence and update
   `CHAPTERS` in `storyCatalog.ts`.
5. Bump the quest's `contentVersion` if you edited a stage that a live save
   could be sitting on; `QuestSystem.repairAfterRestore` falls back to the last
   checkpoint either way, but the bump records that you knew.
