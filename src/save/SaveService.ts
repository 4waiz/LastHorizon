import type { SaveDriver } from './SaveDriver';
import {
  CURRENT_SAVE_VERSION,
  migrateSave,
  validateSave,
  type SaveData,
  type SaveSlotId,
  SAVE_SLOTS,
  isSaveSlot,
} from './SaveSchema';
import type { GameMode } from '../core/Gates';
import { parseImportedSave } from './ImportGuard';

/**
 * Reading and writing saves, safely.
 *
 * The failure this is built around is not "the disk is full" — it is a write
 * interrupted halfway, leaving a half-written record where a good save used to
 * be. So a write never overwrites the live record until the new one has been
 * read back intact, and the previous good record is kept as a backup that a
 * corrupt load falls back to.
 *
 * `Date.now()` is injected rather than called here, so tests are deterministic
 * and the service stays pure enough to reason about.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SlotInfo {
  slot: SaveSlotId;
  exists: boolean;
  mode?: GameMode;
  ageYears?: number;
  savedAt?: number;
  /** True when the record is present but unreadable. */
  corrupt?: boolean;
  /** True when a backup exists that could be recovered. */
  recoverable?: boolean;
}

export type LoadOutcome =
  | { ok: true; data: SaveData; migratedFrom?: number; recoveredFromBackup?: boolean }
  | { ok: false; reason: string; recoverable: boolean };

export type SaveOutcome = { ok: true } | { ok: false; reason: string };

const key = (slot: SaveSlotId) => `save:${slot}`;
const backupKey = (slot: SaveSlotId) => `save:${slot}:backup`;
const tempKey = (slot: SaveSlotId) => `save:${slot}:tmp`;

export class SaveService {
  private status: SaveStatus = 'idle';
  private readonly listeners = new Set<(s: SaveStatus, detail?: string) => void>();

  constructor(
    private readonly driver: SaveDriver,
    /** Injected clock, so saves are deterministic under test. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  get currentStatus(): SaveStatus {
    return this.status;
  }

  onStatus(fn: (s: SaveStatus, detail?: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: SaveStatus, detail?: string): void {
    this.status = s;
    for (const fn of this.listeners) fn(s, detail);
  }

  /**
   * Write a slot.
   *
   * Order matters and is the whole point:
   *   1. serialise and validate *before* touching storage;
   *   2. write to a temp key and read it back — a driver that accepted the
   *      write but stored garbage is caught here, while the live save is
   *      still intact;
   *   3. copy the current live record to backup;
   *   4. commit, then drop the temp.
   * A failure at any step leaves the previous save readable.
   */
  async save(slot: SaveSlotId, data: SaveData): Promise<SaveOutcome> {
    this.setStatus('saving');

    const stamped: SaveData = { ...data, slot, savedAt: this.now() };

    const check = validateSave(stamped);
    if (!check.ok) {
      this.setStatus('error', check.errors.join('; '));
      return { ok: false, reason: `refusing to write an invalid save: ${check.errors.join('; ')}` };
    }

    let json: string;
    try {
      json = JSON.stringify(stamped);
    } catch (err) {
      this.setStatus('error', String(err));
      return { ok: false, reason: `save is not serialisable: ${String(err)}` };
    }

    try {
      await this.driver.put(tempKey(slot), json);
      const readBack = await this.driver.get(tempKey(slot));
      if (readBack !== json) {
        throw new Error('temp record did not read back identical');
      }

      const live = await this.driver.get(key(slot));
      if (live !== null) await this.driver.put(backupKey(slot), live);

      await this.driver.put(key(slot), json);
      await this.driver.delete(tempKey(slot));

      this.setStatus('saved');
      return { ok: true };
    } catch (err) {
      // Best effort: leave no half-written temp behind.
      try {
        await this.driver.delete(tempKey(slot));
      } catch {
        /* the temp key is inert; a failure to clean it is not worth surfacing */
      }
      const reason = `write failed: ${String(err)}`;
      this.setStatus('error', reason);
      return { ok: false, reason };
    }
  }

  /**
   * Read a slot, migrating and recovering as needed.
   *
   * `expectedMode` is how Story and Free Roam saves are kept apart: loading a
   * Free Roam save into a Story session would apply story gates to a run that
   * never had chapters.
   */
  async load(slot: SaveSlotId, expectedMode?: GameMode): Promise<LoadOutcome> {
    const primary = await this.readRecord(slot, key(slot));

    if (primary.ok) {
      if (expectedMode && primary.data.mode !== expectedMode) {
        return {
          ok: false,
          reason: `that is a ${primary.data.mode} save; this is a ${expectedMode} session`,
          recoverable: false,
        };
      }
      return primary;
    }

    // Primary is unreadable. Fall back to the backup rather than losing the run.
    const backup = await this.readRecord(slot, backupKey(slot));
    if (backup.ok) {
      if (expectedMode && backup.data.mode !== expectedMode) {
        return {
          ok: false,
          reason: `that is a ${backup.data.mode} save; this is a ${expectedMode} session`,
          recoverable: false,
        };
      }
      return { ...backup, recoveredFromBackup: true };
    }

    return { ok: false, reason: primary.reason, recoverable: false };
  }

  private async readRecord(
    slot: SaveSlotId,
    storageKey: string,
  ): Promise<LoadOutcome> {
    const raw = await this.driver.get(storageKey);
    if (raw === null) return { ok: false, reason: 'no save in that slot', recoverable: false };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'save is not valid JSON', recoverable: true };
    }

    const version = (parsed as { version?: unknown })?.version;
    const needsMigration = typeof version === 'number' && version < CURRENT_SAVE_VERSION;

    if (needsMigration && storageKey === key(slot)) {
      // Back up the *original* before rewriting it in the new shape. A
      // migration that goes wrong must not be the only copy left.
      await this.driver.put(backupKey(slot), raw);
    }

    const migrated = migrateSave(parsed);
    if (!migrated.ok || !migrated.data) {
      return { ok: false, reason: migrated.error ?? 'save could not be migrated', recoverable: true };
    }

    return migrated.from !== undefined && migrated.from < CURRENT_SAVE_VERSION
      ? { ok: true, data: migrated.data, migratedFrom: migrated.from }
      : { ok: true, data: migrated.data };
  }

  /** Slot summaries for a load menu, including unreadable ones. */
  async listSlots(): Promise<SlotInfo[]> {
    const out: SlotInfo[] = [];
    for (const slot of SAVE_SLOTS) {
      const raw = await this.driver.get(key(slot));
      if (raw === null) {
        out.push({ slot, exists: false });
        continue;
      }
      const read = await this.readRecord(slot, key(slot));
      if (read.ok) {
        out.push({
          slot,
          exists: true,
          mode: read.data.mode,
          ageYears: read.data.life.ageYears,
          savedAt: read.data.savedAt,
        });
      } else {
        const backup = await this.driver.get(backupKey(slot));
        out.push({ slot, exists: true, corrupt: true, recoverable: backup !== null });
      }
    }
    return out;
  }

  async deleteSlot(slot: SaveSlotId): Promise<void> {
    await this.driver.delete(key(slot));
    await this.driver.delete(backupKey(slot));
    await this.driver.delete(tempKey(slot));
  }

  /** Promote a slot's backup to be the live record. */
  async recoverFromBackup(slot: SaveSlotId): Promise<SaveOutcome> {
    const backup = await this.driver.get(backupKey(slot));
    if (backup === null) return { ok: false, reason: 'there is no backup for that slot' };

    const read = await this.readRecord(slot, backupKey(slot));
    if (!read.ok) return { ok: false, reason: `the backup is unreadable: ${read.reason}` };

    await this.driver.put(key(slot), backup);
    this.setStatus('saved', 'recovered from backup');
    return { ok: true };
  }

  /** JSON for the player to keep. Pretty-printed: they may open it. */
  async exportSlot(slot: SaveSlotId): Promise<string | null> {
    const read = await this.load(slot);
    if (!read.ok) return null;
    return JSON.stringify(read.data, null, 2);
  }

  /**
   * Import JSON into a slot.
   *
   * Validated and migrated exactly like a stored save, because an imported
   * file is the least trustworthy input the game accepts — hand-edited,
   * possibly from another build.
   */
  async importInto(slot: SaveSlotId, json: string): Promise<SaveOutcome> {
    // Size, shape, depth, node count, forbidden keys and control characters,
    // before `migrateSave` or `validateSave` form an opinion about *meaning*.
    // Those two reason about fields the schema knows; this reasons about the
    // input, which is the half a hostile file attacks. See `ImportGuard.ts`.
    const guarded = parseImportedSave(json);
    if (!guarded.ok) return { ok: false, reason: guarded.reason };

    const migrated = migrateSave(guarded.value);
    if (!migrated.ok || !migrated.data) {
      return { ok: false, reason: migrated.error ?? 'that file is not a Last Horizon save' };
    }

    return this.save(slot, { ...migrated.data, slot });
  }

  /** Guard for callers holding a slot id from the UI or a URL. */
  static parseSlot(v: string): SaveSlotId | null {
    return isSaveSlot(v) ? v : null;
  }
}
