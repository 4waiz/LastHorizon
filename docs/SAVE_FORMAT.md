# Save format reference

**Current schema version: 5.** Content version: 1.
Source of truth: [`src/save/SaveSchema.ts`](../src/save/SaveSchema.ts).

---

## Two rules the format is built on

**Nothing engine-owned is serialised.** No `THREE.Vector3`, no Rapier bodies,
no materials — only plain numbers, strings, arrays and objects. An engine
object in a save is a save that breaks the next time the engine updates. There
is a test asserting no Three.js markers reach the JSON.

**Every field is reconstructible.** A save records *intent*, not *results*: a
zone id and a spawn **id** rather than a resolved world position, so the world
is rebuilt from the manifest on load and the save stays valid when the layout
changes underneath it.

---

## Storage layout

Saves live in IndexedDB (`lasthorizon` database, `saves` object store). Only
tiny preferences stay in `localStorage`, where synchronous access is an
advantage rather than a frame-time cost.

| Key | Contents |
| --- | --- |
| `save:<slot>` | The live record |
| `save:<slot>:backup` | The previous good record, and the pre-migration original |
| `save:<slot>:tmp` | In-flight write; never present at rest |

Slots: `slot1`, `slot2`, `slot3`, `autosave`.

## Write protocol

Ordered to survive an interrupted write:

1. Serialise and **validate before touching storage**.
2. Write to `:tmp`, then **read it back and compare**. A driver that accepted
   the write but stored garbage is caught here, while the live save is intact.
3. Copy the live record to `:backup`.
4. Commit to `save:<slot>`, then delete `:tmp`.

A failure at any step leaves the previous save readable. A load that cannot
parse the live record falls back to `:backup` automatically and reports
`recoveredFromBackup`.

---

## Schema (v4)

| Field | Type | Notes |
| --- | --- | --- |
| `version` | `4` | Schema version |
| `contentVersion` | number | Bumped when content invalidates positions or quests |
| `savedAt` | number | ms since epoch, **injected** by the caller |
| `mode` | `'story' \| 'freeRoam'` | Load refuses a mismatch |
| `slot` | `SaveSlotId` | Re-stamped on write and on import |
| `zone` | `ZoneId` | Which zone the player is in |
| `spawnId` | string | Spawn **id**, resolved against the manifest on load |
| `player` | `{ position: Vec3, facing }` | Plain numbers |
| `life` | `{ ageYears, yearProgress, lastHandledAge, rate, activeSeconds }` | `lastHandledAge` is what stops a birthday replaying |
| `world` | `{ time, mode, day }` | Day/night presentation state |
| `story` | `{ chapter, chapterSeconds, totalSeconds, completedChapters[], quests, progress? }` | See below |
| `money` | number | |
| `inventory` | `{ id, count }[]` | |
| `wardrobe` | `{ shirt, trousers, hat, hatOn }` | Colours as hex strings |
| `vehicles` | `{ id, kind, zone, position, facing, impounded }[]` | |
| `needs` | `{ hunger, energy, cleanliness, mood }` | 0..1 each |
| `relationships` | `{ npcId, familiarity, trust, affection, fear, respect }[]` | |
| `collectibles` | `string[]` | Ids of found keepsakes |
| `unlockedZones` | `ZoneId[]` | Free Roam presets, or story-earned |

### `story.progress`, added in v4

The authored story's own state, borrowed from
[`StoryState`](../src/story/StoryState.ts) rather than restated here. That
matters: Phase 7's `EconomySaveData` restated `kind` as a bare `string` and
failed to compile against its own reader, and the first draft of this field did
exactly the same thing to the reel's event kind. One definition, imported,
cannot drift from the thing it describes.

| Field | Notes |
| --- | --- |
| `flags` | Story flags, sorted |
| `choices` | Recorded decisions, id → value. **First write wins** |
| `reputation` | `{ community, law }`, each 0..1 |
| `reel` | Life Reel moments: kind, age, localisation key, optional detail |
| `quests` | Per quest: stage id, per-objective progress, state, elapsed |
| `paidRewards` | Award keys already paid. What makes a quest reward idempotent |
| `endingId` | Null until chapter 7 resolves |

Two things are deliberately **not** in it. There is no copy of the quest
*definitions* — a save records where you are, and the graph is rebuilt from the
catalogue, exactly as the world is rebuilt from the manifest. And there is no
cutscene or dialogue position: a conversation is a thing you are in the middle
of for thirty seconds, and restoring one mid-sentence is worse than reopening it.

The sibling `quests` field (id → number) predates this and is kept in step for
the same reason `money` is kept in step with `economy.wallet`: a reader written
against v3 still sees roughly where the player is. Nothing in this build reads it.

### Stages that no longer exist

A save can name a stage a later build has deleted. `QuestSystem.repairAfterRestore`
walks every active run and, for any whose stage is gone, drops it to the last
**checkpoint at or before** where it was — somewhere the player has already
been. Dropping the quest instead would lose the run; guessing forward would
skip content.

### Validation

`validateSave` is strict about the fields that decide **where the player ends
up** and lenient elsewhere: a wrong money value is a nuisance, a `NaN` position
drops the character through the world. It returns every problem it found, not
just the first.

`story.progress` is deliberately *not* validated strictly. `StoryState.restore`
is defensive field by field — every one is optional with a default that reads
as a plausible run — so a malformed story block degrades to "nothing has
happened yet" rather than refusing the save. A player who loses their quest
log keeps their house, their money and their friends; refusing the whole save
would lose all four.

---

## Migration

`migrateSave` walks a save up one version at a time and names the step it
failed on. A save from a **newer** build is rejected rather than guessed at.

### v1 → v2

v1 predates needs, relationships, vehicles, inventory, wardrobe and zone
unlocks. Defaults are chosen so an old save loads as a *plausible* run rather
than a broken one:

| Added | Default | Why |
| --- | --- | --- |
| `needs` | all `1` | Full, not starving |
| `relationships` | `[]` | No history, rather than invented history |
| `vehicles` | `[]` | Nothing owned |
| `inventory` | `[]` | |
| `wardrobe` | the default outfit | |
| `story` | chapter 1, no completions | |
| `unlockedZones` | `['village_coast']` | Re-earn city access |

The **original** is copied to `:backup` before the migrated form is written, so
a migration that goes wrong is not the only copy left.

### v2 → v3

The economy, interiors and jobs. The old `money` becomes cash in hand with an
empty bank and an empty ledger. `inside` is `null` rather than guessed: a v2
save recorded neither a door nor a return context, so there is no way to know
which building a player was standing in, and putting them outside is the one
answer that is never wrong.

### v3 → v4

The authored story, and it adds exactly one optional field.

`story.progress` is left **absent** rather than filled with an empty run.
Absent and empty mean the same thing to `StoryState.restore`, and absent is the
honest record: a v3 save did not have a story, so it does not get one invented.
The player picks it up at chapter 1 with whatever money, vehicles and
friendships they had already earned.

### v4 → v5

Phase 9's optional systems, and it adds exactly one optional field: `combat`.

Two serialised blobs — what the player carries, and what the police know —
borrowed from `CombatState` rather than restated, for the reason this file
gives at length above. A v4 save is left **without** it rather than given an
empty record: absent and empty mean the same thing to `CombatState.restore`,
and absent is the honest one. A player who never drew a weapon does not get a
criminal record invented for them.

---

## Fixtures

`tests/fixtures/saves/v1.json` … `v5.json`, one per version this game has
ever written, walked to the current schema by
`tests/saveMigrationFixtures.test.ts` on every commit.

They are **hand-authored and frozen**: written from the interfaces at the
version each claims, with a fixed `savedAt` so they are byte-identical on
every machine and a diff means somebody edited one. Regenerating them from the
current code would make the test circular — it would prove only that the
migrations agree with themselves.

Writing them found the first draft encoding an economy shape no build ever
wrote (`paidAwards` where the field is `awards`), which is exactly the kind
of thing a fixture is for.

**When `CURRENT_SAVE_VERSION` next goes up, add `v<n>.json`.** A count
assertion fails until you do.

---

## The service worker reads this number

`scripts/vite-plugin-pwa.ts` parses `CURRENT_SAVE_VERSION` out of
`SaveSchema.ts` and puts it in the service worker's cache name:

```
lh-0.1.0-172aef0-s5-f1
                  ^^ this file
```

So a schema bump orphans every previously cached build by construction. It is
read rather than restated because a second copy is a second thing to forget to
bump, and the cost of forgetting is a cached old build handed a new save.

---

## Export and import

`exportSlot` returns pretty-printed JSON — the player may open it, so it should
be readable. `importInto` runs the same validation and migration as a stored
save, because an imported file is the least trustworthy input the game accepts:
hand-edited, possibly from another build. An imported save is re-stamped to the
slot it lands in.

---

## Adding a field

1. Add it to `SaveDataV2` (or create `SaveDataV3` and bump
   `CURRENT_SAVE_VERSION`).
2. Add a migration step and a default that reads as a plausible run.
3. Extend `validateSave` **only** if the field can strand the player.
4. Add a test with a fixture of the old shape.
5. Never add a field that holds an engine object.
