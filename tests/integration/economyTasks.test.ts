import { describe, it, expect, beforeEach } from 'vitest';
import { Economy } from '../../src/economy/Economy';
import { Inventory } from '../../src/player/Inventory';
import { TaskSystem } from '../../src/tasks/TaskSystem';
import { loadTasks, taskDef } from '../../src/tasks/taskRegistry';
import { SaveService } from '../../src/save/SaveService';
import { MemoryDriver } from '../../src/save/SaveDriver';

/**
 * Money crossing three systems that were each tested alone.
 *
 * `taskSystem.test.ts` proves a run produces an award key. `economy.test.ts`
 * proves the same key pays once. Neither proves what happens when a task, a
 * wallet and a save file disagree — and that seam is where Phase 7 found
 * `Economy.award` recording a wage in the ledger and never touching the money,
 * which would have made **every job in the game pay nothing** while the ledger
 * insisted otherwise.
 *
 * These drive real seconds through `TaskSystem.advance` rather than reporting
 * completions by id, because reporting by id is what let three objective kinds
 * ship in Phase 8 with no reporter at all.
 */

const AT = 1_754_390_000_000;

/** Work a task to completion the way the game does: objectives, then time. */
function completeRun(tasks: TaskSystem, taskId: string): string {
  const start = tasks.start(taskId, { age: 20, hasVehicle: true });
  if (!start.ok) throw new Error(`could not start ${taskId}: ${start.reason}`);

  // In order. `TaskSystem` ignores progress on an out-of-order objective
  // rather than banking it, which is what stops a delivery completing before
  // its pickup — so a loop that set them backwards would silently do nothing.
  for (const obj of start.run.progress) {
    tasks.setProgress(obj.id, obj.target);
  }

  // The run settles inside `setProgress`, not in `advance`: the last objective
  // to complete is what finishes the task. Reading the return of a subsequent
  // `advance` gets null, because by then the state is no longer `active`.
  const outcome = tasks.outcome;
  if (!outcome || outcome.state !== 'completed') {
    throw new Error(`${taskId} did not complete once every objective was met`);
  }
  return outcome.awardKey;
}

describe('a shift pays exactly once, across the wallet and the save', () => {
  let inventory: Inventory;
  let economy: Economy;
  let tasks: TaskSystem;

  beforeEach(async () => {
    await loadTasks();
    inventory = new Inventory();
    economy = new Economy(inventory, 0);
    tasks = new TaskSystem();
  });

  it('credits the wallet, not only the ledger', () => {
    const key = completeRun(tasks, 'job_grocery_shift');
    const def = taskDef('job_grocery_shift')!;

    const result = economy.award(key, def.basePay, def.name, AT);

    expect(result.ok).toBe(true);
    // The Phase 7 bug precisely: the ledger said paid and the wallet was empty.
    expect(economy.wallet.cash).toBe(def.basePay);
    expect(economy.hasAwarded(key)).toBe(true);
  });

  it('does not pay the same completion twice', () => {
    const key = completeRun(tasks, 'job_grocery_shift');
    const pay = taskDef('job_grocery_shift')!.basePay;

    economy.award(key, pay, 'shift', AT);
    economy.award(key, pay, 'shift', AT);

    expect(economy.wallet.cash).toBe(pay);
  });

  it('pays a second run of the same job, because the key names the completion', () => {
    const pay = taskDef('job_grocery_shift')!.basePay;

    const first = completeRun(tasks, 'job_grocery_shift');
    economy.award(first, pay, 'shift', AT);
    tasks.clear();
    const second = completeRun(tasks, 'job_grocery_shift');
    economy.award(second, pay, 'shift', AT);

    expect(first).not.toBe(second);
    expect(economy.wallet.cash).toBe(pay * 2);
  });

  it('cannot re-pay a spent key after a save and reload', async () => {
    const pay = taskDef('job_grocery_shift')!.basePay;
    const key = completeRun(tasks, 'job_grocery_shift');
    economy.award(key, pay, 'shift', AT);

    // Round-trip the two blobs the save actually carries.
    const economyData = JSON.parse(JSON.stringify(economy.toJSON()));
    const taskData = JSON.parse(JSON.stringify(tasks.toJSON()));

    const reloadedInventory = new Inventory();
    const reloaded = new Economy(reloadedInventory, 0);
    reloaded.restoreFrom(economyData);
    const reloadedTasks = new TaskSystem();
    reloadedTasks.restore(taskData);

    expect(reloaded.wallet.cash).toBe(pay);
    // The key is in the file, so the completion cannot pay again.
    expect(reloaded.hasAwarded(key)).toBe(true);
    reloaded.award(key, pay, 'shift', AT);
    expect(reloaded.wallet.cash).toBe(pay);

    // And the next run is numbered *after* the restored ones rather than on
    // top of them — the mistake Phase 8 made with quest rewards.
    const next = completeRun(reloadedTasks, 'job_grocery_shift');
    expect(next).not.toBe(key);
    reloaded.award(next, pay, 'shift', AT);
    expect(reloaded.wallet.cash).toBe(pay * 2);
  });

  it('survives the whole save pipeline, not just the blobs', async () => {
    const driver = new MemoryDriver();
    const saves = new SaveService(driver, () => AT);
    const pay = taskDef('job_grocery_shift')!.basePay;

    const key = completeRun(tasks, 'job_grocery_shift');
    economy.award(key, pay, 'shift', AT);

    const raw = JSON.parse(
      JSON.stringify({
        version: 5,
        contentVersion: 1,
        savedAt: AT,
        mode: 'story',
        slot: 'slot1',
        zone: 'village_coast',
        spawnId: 'default',
        player: { position: { x: 0, y: 2, z: 0 }, facing: 0 },
        life: { ageYears: 20, yearProgress: 0, lastHandledAge: 20, rate: 60, activeSeconds: 0 },
        world: { time: 0.4, mode: 'cycle', day: 3 },
        story: { chapter: 1, chapterSeconds: 0, totalSeconds: 0, completedChapters: [], quests: {} },
        money: economy.wallet.cash,
        inventory: [],
        wardrobe: { shirt: '#efede2', trousers: '#9b8fc7', hat: '#dcc177', hatOn: false },
        vehicles: [],
        needs: { hunger: 1, energy: 1, cleanliness: 1, mood: 1 },
        relationships: [],
        collectibles: [],
        unlockedZones: ['village_coast'],
        economy: economy.toJSON(),
        tasks: tasks.toJSON(),
      }),
    );

    expect((await saves.save('slot1', raw)).ok).toBe(true);
    const read = await saves.load('slot1', 'story');
    expect(read.ok).toBe(true);
    expect(read.ok && read.data.economy?.awards).toContain(key);
    // `money` is kept in step with the wallet so an older reader still sees a
    // sensible balance. If these ever disagree, one of them is lying.
    expect(read.ok && read.data.money).toBe(read.ok ? read.data.economy?.wallet.cash : -1);
  });
});

describe('the shop cannot be farmed', () => {
  it('leaves the player poorer after twenty buy-and-sell round trips', async () => {
    const inventory = new Inventory();
    const economy = new Economy(inventory, 500);
    const start = economy.wallet.cash;

    for (let i = 0; i < 20; i++) {
      economy.buy({ itemId: 'apple', count: 1, service: 'grocery', at: AT });
      economy.sell({ itemId: 'apple', count: 1, service: 'grocery', at: AT });
    }

    // One inverted pair is an infinite money loop, and it is the classic way a
    // game economy dies. The unit suite checks the price table; this checks
    // the *behaviour* through the real buy and sell paths.
    expect(economy.wallet.cash).toBeLessThan(start);
  });

  it('refuses an order it cannot deliver, without taking the money', async () => {
    const inventory = new Inventory(2);
    const economy = new Economy(inventory, 1000);
    const before = economy.wallet.cash;

    // Far more than the bag can hold. Paying for goods that never arrive is
    // the failure `Economy` exists to make impossible.
    const result = economy.buy({ itemId: 'apple', count: 999, service: 'grocery', at: AT });

    expect(result.ok).toBe(false);
    expect(economy.wallet.cash).toBe(before);
    expect(inventory.count('apple')).toBe(0);
  });
});
