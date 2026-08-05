# Save format reference

**Current schema version: 2.** Content version: 1.
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

## Schema (v2)

| Field | Type | Notes |
| --- | --- | --- |
| `version` | `2` | Schema version |
| `contentVersion` | number | Bumped when content invalidates positions or quests |
| `savedAt` | number | ms since epoch, **injected** by the caller |
| `mode` | `'story' \| 'freeRoam'` | Load refuses a mismatch |
| `slot` | `SaveSlotId` | Re-stamped on write and on import |
| `zone` | `ZoneId` | Which zone the player is in |
| `spawnId` | string | Spawn **id**, resolved against the manifest on load |
| `player` | `{ position: Vec3, facing }` | Plain numbers |
| `life` | `{ ageYears, yearProgress, lastHandledAge, rate, activeSeconds }` | `lastHandledAge` is what stops a birthday replaying |
| `world` | `{ time, mode, day }` | Day/night presentation state |
| `story` | `{ chapter, chapterSeconds, totalSeconds, completedChapters[], quests }` | `quests` maps id → stage |
| `money` | number | |
| `inventory` | `{ id, count }[]` | |
| `wardrobe` | `{ shirt, trousers, hat, hatOn }` | Colours as hex strings |
| `vehicles` | `{ id, kind, zone, position, facing, impounded }[]` | |
| `needs` | `{ hunger, energy, cleanliness, mood }` | 0..1 each |
| `relationships` | `{ npcId, familiarity, trust, affection, fear, respect }[]` | |
| `collectibles` | `string[]` | Ids of found keepsakes |
| `unlockedZones` | `ZoneId[]` | Free Roam presets, or story-earned |

### Validation

`validateSave` is strict about the fields that decide **where the player ends
up** and lenient elsewhere: a wrong money value is a nuisance, a `NaN` position
drops the character through the world. It returns every problem it found, not
just the first.

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
