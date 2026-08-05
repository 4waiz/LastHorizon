import { describe, it, expect, vi } from 'vitest';
import { MemoryDriver } from '../src/save/SaveDriver';
import { SaveService } from '../src/save/SaveService';
import {
  CURRENT_SAVE_VERSION,
  migrateSave,
  newSave,
  validateSave,
  type SaveData,
  type SaveDataV1,
} from '../src/save/SaveSchema';

let clock = 1_000_000;
const now = () => clock++;

function service() {
  const driver = new MemoryDriver();
  return { driver, svc: new SaveService(driver, now) };
}

const story = (over: Partial<SaveData> = {}): SaveData => ({
  ...newSave({ mode: 'story', slot: 'slot1', savedAt: 1, age: 15, rate: 60 }),
  ...over,
});

describe('save round trip', () => {
  it('writes and reads a save back intact', async () => {
    const { svc } = service();
    const data = story({ money: 42 });
    expect((await svc.save('slot1', data)).ok).toBe(true);

    const read = await svc.load('slot1');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.data.money).toBe(42);
      expect(read.data.life.ageYears).toBe(15);
      expect(read.data.zone).toBe('village_coast');
    }
  });

  it('reports an empty slot rather than throwing', async () => {
    const { svc } = service();
    const read = await svc.load('slot2');
    expect(read.ok).toBe(false);
  });

  it('stamps the slot and time on write', async () => {
    const { svc } = service();
    await svc.save('slot3', story());
    const read = await svc.load('slot3');
    expect(read.ok && read.data.slot).toBe('slot3');
    expect(read.ok && read.data.savedAt).toBeGreaterThan(0);
  });

  it('never writes engine objects', async () => {
    const { driver, svc } = service();
    await svc.save('slot1', story());
    const raw = await driver.get('save:slot1');
    // A Three.js Vector3 would serialise with these; plain data must not.
    expect(raw).not.toMatch(/isVector3|__three|_geometry/);
  });
});

describe('atomic writes and failure recovery', () => {
  it('leaves the previous save intact when a write fails', async () => {
    const { driver, svc } = service();
    await svc.save('slot1', story({ money: 100 }));

    driver.failNextWrite = true;
    const result = await svc.save('slot1', story({ money: 999 }));
    expect(result.ok).toBe(false);

    const read = await svc.load('slot1');
    expect(read.ok && read.data.money).toBe(100);
  });

  it('leaves no temp record behind after a failed write', async () => {
    const { driver, svc } = service();
    driver.failNextWrite = true;
    await svc.save('slot1', story());
    expect(await driver.get('save:slot1:tmp')).toBeNull();
  });

  it('refuses to write a save that would not load', async () => {
    const { svc } = service();
    const bad = story();
    (bad.player.position as { x: number }).x = Number.NaN;
    const result = await svc.save('slot1', bad);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/invalid/i);
  });

  it('keeps the previous save as a backup', async () => {
    const { driver, svc } = service();
    await svc.save('slot1', story({ money: 1 }));
    await svc.save('slot1', story({ money: 2 }));
    const backup = await driver.get('save:slot1:backup');
    expect(backup).toContain('"money":1');
  });
});

describe('corruption', () => {
  it('recovers from the backup when the live record is corrupt', async () => {
    const { driver, svc } = service();
    await svc.save('slot1', story({ money: 500 }));
    await svc.save('slot1', story({ money: 600 }));

    driver.poke('save:slot1', '{ this is not json');

    const read = await svc.load('slot1');
    expect(read.ok).toBe(true);
    expect(read.ok && read.recoveredFromBackup).toBe(true);
    expect(read.ok && read.data.money).toBe(500);
  });

  it('reports corruption when there is no backup either', async () => {
    const { driver, svc } = service();
    driver.poke('save:slot1', 'not json at all');
    const read = await svc.load('slot1');
    expect(read.ok).toBe(false);
  });

  it('rejects a save whose shape is wrong even if it parses', async () => {
    const { driver, svc } = service();
    driver.poke('save:slot1', JSON.stringify({ version: CURRENT_SAVE_VERSION, nonsense: true }));
    const read = await svc.load('slot1');
    expect(read.ok).toBe(false);
  });

  it('rejects a save from a newer build rather than guessing', async () => {
    const { driver, svc } = service();
    driver.poke('save:slot1', JSON.stringify({ ...story(), version: 99 }));
    const read = await svc.load('slot1');
    expect(read.ok).toBe(false);
  });

  it('lists a corrupt slot as corrupt and recoverable', async () => {
    const { driver, svc } = service();
    await svc.save('slot1', story());
    await svc.save('slot1', story({ money: 5 }));
    driver.poke('save:slot1', 'broken');

    const slots = await svc.listSlots();
    const s1 = slots.find((s) => s.slot === 'slot1')!;
    expect(s1.corrupt).toBe(true);
    expect(s1.recoverable).toBe(true);
  });

  it('can promote the backup explicitly', async () => {
    const { driver, svc } = service();
    await svc.save('slot1', story({ money: 7 }));
    await svc.save('slot1', story({ money: 8 }));
    driver.poke('save:slot1', 'broken');

    expect((await svc.recoverFromBackup('slot1')).ok).toBe(true);
    const read = await svc.load('slot1');
    expect(read.ok && read.data.money).toBe(7);
  });
});

describe('migration', () => {
  const v1: SaveDataV1 = {
    version: 1,
    savedAt: 123,
    mode: 'story',
    slot: 'slot1',
    zone: 'village_coast',
    spawnId: 'village_start',
    player: { position: { x: 1, y: 2, z: 3 }, facing: 0.5 },
    life: { ageYears: 16, yearProgress: 0.25, lastHandledAge: 16, rate: 60, activeSeconds: 3600 },
    world: { time: 0.4, mode: 'cycle', day: 2 },
    money: 250,
    collectibles: ['paper_plane'],
  };

  it('brings a v1 save up to the current shape', () => {
    const r = migrateSave(v1);
    expect(r.ok).toBe(true);
    expect(r.data?.version).toBe(CURRENT_SAVE_VERSION);
    expect(r.from).toBe(1);
    // Carried through.
    expect(r.data?.money).toBe(250);
    expect(r.data?.life.ageYears).toBe(16);
    expect(r.data?.collectibles).toEqual(['paper_plane']);
    // Defaulted sensibly rather than left undefined.
    expect(r.data?.needs.hunger).toBe(1);
    expect(r.data?.relationships).toEqual([]);
    expect(r.data?.vehicles).toEqual([]);
  });

  it('migrates on load and reports the version it came from', async () => {
    const { driver, svc } = service();
    driver.poke('save:slot1', JSON.stringify(v1));
    const read = await svc.load('slot1');
    expect(read.ok).toBe(true);
    expect(read.ok && read.migratedFrom).toBe(1);
  });

  it('backs up the original before migrating it', async () => {
    const { driver, svc } = service();
    driver.poke('save:slot1', JSON.stringify(v1));
    await svc.load('slot1');
    const backup = await driver.get('save:slot1:backup');
    expect(backup).toContain('"version":1');
  });

  it('refuses a save with no version at all', () => {
    expect(migrateSave({ money: 5 }).ok).toBe(false);
  });
});

describe('story and free roam cannot be mixed', () => {
  it('refuses to load a free roam save into a story session', async () => {
    const { svc } = service();
    await svc.save('slot1', story({ mode: 'freeRoam' }));
    const read = await svc.load('slot1', 'story');
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.reason).toMatch(/freeRoam/);
  });

  it('refuses the reverse too', async () => {
    const { svc } = service();
    await svc.save('slot1', story({ mode: 'story' }));
    const read = await svc.load('slot1', 'freeRoam');
    expect(read.ok).toBe(false);
  });

  it('loads happily when the mode matches', async () => {
    const { svc } = service();
    await svc.save('slot1', story({ mode: 'freeRoam' }));
    expect((await svc.load('slot1', 'freeRoam')).ok).toBe(true);
  });

  it('reports each slot mode so a menu can separate them', async () => {
    const { svc } = service();
    await svc.save('slot1', story({ mode: 'story' }));
    await svc.save('slot2', story({ mode: 'freeRoam' }));
    const slots = await svc.listSlots();
    expect(slots.find((s) => s.slot === 'slot1')?.mode).toBe('story');
    expect(slots.find((s) => s.slot === 'slot2')?.mode).toBe('freeRoam');
    expect(slots.find((s) => s.slot === 'slot3')?.exists).toBe(false);
  });
});

describe('export and import', () => {
  it('round-trips through exported JSON', async () => {
    const { svc } = service();
    await svc.save('slot1', story({ money: 314 }));
    const json = await svc.exportSlot('slot1');
    expect(json).toBeTruthy();

    expect((await svc.importInto('slot2', json!)).ok).toBe(true);
    const read = await svc.load('slot2');
    expect(read.ok && read.data.money).toBe(314);
    // The import is re-stamped to the slot it landed in.
    expect(read.ok && read.data.slot).toBe('slot2');
  });

  it('rejects a file that is not JSON', async () => {
    const { svc } = service();
    const r = await svc.importInto('slot1', 'definitely not json');
    expect(r.ok).toBe(false);
  });

  it('rejects a JSON file that is not a save', async () => {
    const { svc } = service();
    const r = await svc.importInto('slot1', JSON.stringify({ hello: 'world' }));
    expect(r.ok).toBe(false);
  });

  it('accepts an exported v1 file and migrates it', async () => {
    const { svc } = service();
    const r = await svc.importInto('slot1', JSON.stringify({
      version: 1,
      savedAt: 1,
      mode: 'story',
      slot: 'slot1',
      zone: 'village_coast',
      spawnId: 'village_start',
      player: { position: { x: 0, y: 0, z: 0 }, facing: 0 },
      life: { ageYears: 17, yearProgress: 0, lastHandledAge: 17, rate: 60, activeSeconds: 0 },
      world: { time: 0.5, mode: 'cycle', day: 1 },
      money: 10,
      collectibles: [],
    }));
    expect(r.ok).toBe(true);
    const read = await svc.load('slot1');
    expect(read.ok && read.data.life.ageYears).toBe(17);
  });
});

describe('status reporting', () => {
  it('announces saving then saved', async () => {
    const { svc } = service();
    const seen: string[] = [];
    svc.onStatus((s) => seen.push(s));
    await svc.save('slot1', story());
    expect(seen).toEqual(['saving', 'saved']);
  });

  it('announces an error when a write fails', async () => {
    const { driver, svc } = service();
    const seen: string[] = [];
    svc.onStatus((s) => seen.push(s));
    driver.failNextWrite = true;
    await svc.save('slot1', story());
    expect(seen).toContain('error');
  });

  it('stops announcing once unsubscribed', async () => {
    const { svc } = service();
    const fn = vi.fn();
    const off = svc.onStatus(fn);
    off();
    await svc.save('slot1', story());
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('accepts a fresh save', () => {
    expect(validateSave(story()).ok).toBe(true);
  });

  it('rejects a non-finite position, which would drop the player', () => {
    const bad = story();
    (bad.player.position as { y: number }).y = Number.POSITIVE_INFINITY;
    expect(validateSave(bad).ok).toBe(false);
  });

  it('rejects an unknown slot id', () => {
    expect(validateSave({ ...story(), slot: 'slot9' }).ok).toBe(false);
  });

  it('names every problem it found', () => {
    const r = validateSave({ version: CURRENT_SAVE_VERSION });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(3);
  });
});
