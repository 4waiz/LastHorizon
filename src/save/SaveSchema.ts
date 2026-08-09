import type { ZoneId } from '../world/zones/Manifest';
import type { GameMode } from '../core/Gates';
import type { LifeRate } from '../core/clocks/LifeClock';
import type { TimeMode } from '../core/Settings';

/**
 * The save format, versioned.
 *
 * Two rules shape everything here:
 *
 * 1. **Nothing engine-owned is serialised.** No Three.js vectors, no Rapier
 *    bodies, no materials — only plain numbers and strings. An engine object in
 *    a save is a save that breaks the next time the engine updates.
 * 2. **Every field is reconstructible.** A save records intent (zone id, spawn
 *    id, age) rather than results (loaded chunks, resolved collider). The world
 *    is rebuilt from the manifest on load, so a save stays valid when the world
 *    changes underneath it.
 */

/** Bump when the shape changes, and add a migration for the step. */
export const CURRENT_SAVE_VERSION = 2;

/** Bump when *content* changes in a way that invalidates positions or quests. */
export const CONTENT_VERSION = 1;

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

export interface PlayerTransformData {
  position: Vec3Data;
  facing: number;
}

export interface LifeClockData {
  ageYears: number;
  yearProgress: number;
  lastHandledAge: number;
  rate: LifeRate;
  activeSeconds: number;
}

export interface WorldTimeData {
  time: number;
  mode: TimeMode;
  day: number;
}

export interface StoryStateData {
  chapter: number;
  chapterSeconds: number;
  totalSeconds: number;
  completedChapters: string[];
  /** Quest id -> stage. */
  quests: Record<string, number>;
}

export interface InventoryItemData {
  id: string;
  count: number;
}

export interface WardrobeData {
  shirt: string;
  trousers: string;
  hat: string;
  hatOn: boolean;
}

export interface VehicleData {
  id: string;
  kind: string;
  zone: ZoneId;
  position: Vec3Data;
  facing: number;
  impounded: boolean;
  /**
   * Added in Phase 5. Optional rather than required, so a v2 save written
   * before vehicles existed still loads: `VehicleRegistry.restore` fills each
   * of these from the definition when it is absent, which is the same thing a
   * freshly registered vehicle gets.
   */
  owned?: boolean;
  locked?: boolean;
  condition?: number;
  /** Null for anything that never burns fuel. */
  fuel?: number | null;
}

export interface NeedsData {
  hunger: number;
  energy: number;
  cleanliness: number;
  mood: number;
}

export interface RelationshipData {
  npcId: string;
  familiarity: number;
  trust: number;
  affection: number;
  fear: number;
  respect: number;
}

/**
 * A named resident's own state.
 *
 * Only what cannot be recomputed. Position is not here: a resident's place in
 * the world is a function of the clock and their schedule, so restoring one is
 * a matter of asking the schedule where they should be, not of remembering
 * where they were. Age is here because it is history — it advances with the
 * player's birthdays and nothing else can reconstruct it.
 */
export interface NpcStateData {
  id: string;
  age: number;
}

/** The current save shape. */
export interface SaveDataV2 {
  version: 2;
  contentVersion: number;
  /** Milliseconds since epoch, stamped by the caller — never Date.now() here. */
  savedAt: number;
  mode: GameMode;
  slot: SaveSlotId;

  zone: ZoneId;
  /** Spawn *id*, not a resolved position: chunks may have moved. */
  spawnId: string;
  player: PlayerTransformData;

  life: LifeClockData;
  world: WorldTimeData;
  story: StoryStateData;

  money: number;
  inventory: InventoryItemData[];
  wardrobe: WardrobeData;
  vehicles: VehicleData[];
  needs: NeedsData;
  relationships: RelationshipData[];
  /**
   * Added in Phase 6. Optional rather than required, the same way `VehicleData`
   * grew in Phase 5: a v2 save written before anyone lived here still loads,
   * and every resident starts at their catalogue age, which is exactly what a
   * save from before they existed should mean.
   */
  npcs?: NpcStateData[];
  /** Ids of collected keepsakes. */
  collectibles: string[];
  /** Free Roam zone unlocks, or story-earned ones. */
  unlockedZones: ZoneId[];
}

/** The shape before needs, relationships and vehicles existed. */
export interface SaveDataV1 {
  version: 1;
  savedAt: number;
  mode: GameMode;
  slot: SaveSlotId;
  zone: ZoneId;
  spawnId: string;
  player: PlayerTransformData;
  life: LifeClockData;
  world: WorldTimeData;
  money: number;
  collectibles: string[];
}

export type AnySaveData = SaveDataV1 | SaveDataV2;
export type SaveData = SaveDataV2;

export type SaveSlotId = 'slot1' | 'slot2' | 'slot3' | 'autosave';
export const SAVE_SLOTS: readonly SaveSlotId[] = ['slot1', 'slot2', 'slot3', 'autosave'];

export function isSaveSlot(v: string): v is SaveSlotId {
  return (SAVE_SLOTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkVec3(v: unknown, path: string, errors: string[]): void {
  if (!isObj(v) || !isNum(v.x) || !isNum(v.y) || !isNum(v.z)) {
    errors.push(`${path} is not a finite vector`);
  }
}

/**
 * Structural validation of an already-migrated save.
 *
 * Deliberately strict about the fields that decide *where the player ends up*.
 * A save with a wrong money value is a nuisance; one with a NaN position drops
 * the character through the world.
 */
export function validateSave(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['save is not an object'] };

  if (raw.version !== CURRENT_SAVE_VERSION) {
    errors.push(`unexpected version ${String(raw.version)}`);
  }
  if (typeof raw.zone !== 'string' || raw.zone.length === 0) errors.push('missing zone');
  if (typeof raw.spawnId !== 'string') errors.push('missing spawnId');
  if (raw.mode !== 'story' && raw.mode !== 'freeRoam') errors.push('invalid mode');
  if (typeof raw.slot !== 'string' || !isSaveSlot(raw.slot)) errors.push('invalid slot');
  if (!isNum(raw.savedAt)) errors.push('invalid savedAt');
  if (!isNum(raw.money)) errors.push('invalid money');

  if (!isObj(raw.player)) errors.push('missing player');
  else {
    checkVec3(raw.player.position, 'player.position', errors);
    if (!isNum(raw.player.facing)) errors.push('player.facing is not finite');
  }

  if (!isObj(raw.life)) errors.push('missing life');
  else {
    if (!isNum(raw.life.ageYears)) errors.push('life.ageYears is not finite');
    if (!isNum(raw.life.yearProgress)) errors.push('life.yearProgress is not finite');
  }

  if (!isObj(raw.world)) errors.push('missing world');
  else if (!isNum(raw.world.time)) errors.push('world.time is not finite');

  if (!Array.isArray(raw.collectibles)) errors.push('collectibles is not an array');
  if (!Array.isArray(raw.inventory)) errors.push('inventory is not an array');
  if (!Array.isArray(raw.vehicles)) errors.push('vehicles is not an array');
  if (!Array.isArray(raw.relationships)) errors.push('relationships is not an array');

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface MigrationResult {
  ok: boolean;
  data?: SaveData;
  from?: number;
  error?: string;
}

/**
 * Bring any supported older save up to the current shape.
 *
 * Each step is a separate function so the chain stays readable as versions
 * accumulate, and so a failure can name the step it died on.
 */
export function migrateSave(raw: unknown): MigrationResult {
  if (!isObj(raw)) return { ok: false, error: 'save is not an object' };

  const version = raw.version;
  if (!isNum(version)) return { ok: false, error: 'save has no version' };
  if (version > CURRENT_SAVE_VERSION) {
    return {
      ok: false,
      error: `save is from a newer version (${version} > ${CURRENT_SAVE_VERSION})`,
    };
  }

  let data: unknown = raw;
  const from = version;

  if (version === 1) data = v1ToV2(data as SaveDataV1);

  const check = validateSave(data);
  if (!check.ok) return { ok: false, from, error: check.errors.join('; ') };

  return { ok: true, data: data as SaveData, from };
}

/**
 * v1 -> v2: needs, relationships, vehicles, inventory, wardrobe and zone
 * unlocks did not exist. Defaults are chosen so an old save loads as a
 * *plausible* run rather than a broken one: full needs rather than starving,
 * no debts, nothing owned.
 */
function v1ToV2(old: SaveDataV1): SaveDataV2 {
  return {
    version: 2,
    contentVersion: CONTENT_VERSION,
    savedAt: old.savedAt,
    mode: old.mode,
    slot: old.slot,
    zone: old.zone,
    spawnId: old.spawnId,
    player: old.player,
    life: old.life,
    world: old.world,
    story: {
      chapter: 1,
      chapterSeconds: 0,
      totalSeconds: 0,
      completedChapters: [],
      quests: {},
    },
    money: old.money,
    inventory: [],
    wardrobe: { shirt: '#efede2', trousers: '#9b8fc7', hat: '#dcc177', hatOn: true },
    vehicles: [],
    needs: { hunger: 1, energy: 1, cleanliness: 1, mood: 1 },
    relationships: [],
    collectibles: old.collectibles ?? [],
    unlockedZones: ['village_coast'],
  };
}

/** A fresh save for a new run. `savedAt` is injected so this stays pure. */
export function newSave(opts: {
  mode: GameMode;
  slot: SaveSlotId;
  savedAt: number;
  age: number;
  rate: LifeRate;
  money?: number;
  unlockedZones?: ZoneId[];
}): SaveData {
  return {
    version: 2,
    contentVersion: CONTENT_VERSION,
    savedAt: opts.savedAt,
    mode: opts.mode,
    slot: opts.slot,
    zone: 'village_coast',
    spawnId: 'village_start',
    player: { position: { x: 5.4, y: 9.4, z: -39.3 }, facing: Math.PI },
    life: {
      ageYears: opts.age,
      yearProgress: 0,
      lastHandledAge: opts.age,
      rate: opts.rate,
      activeSeconds: 0,
    },
    world: { time: 0.615, mode: 'cycle', day: 1 },
    story: { chapter: 1, chapterSeconds: 0, totalSeconds: 0, completedChapters: [], quests: {} },
    money: opts.money ?? 0,
    inventory: [],
    wardrobe: { shirt: '#efede2', trousers: '#9b8fc7', hat: '#dcc177', hatOn: true },
    vehicles: [],
    needs: { hunger: 1, energy: 1, cleanliness: 1, mood: 1 },
    relationships: [],
    collectibles: [],
    unlockedZones: opts.unlockedZones ?? ['village_coast'],
  };
}
