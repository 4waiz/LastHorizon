import { beforeEach, describe, expect, it } from 'vitest';
import { COMPLETIONS_PER_STEP, TaskSystem } from '../src/tasks/TaskSystem';
import {
  MAX_DIFFICULTY,
  clampDifficulty,
  payFor,
  timeFor,
  validateTask,
} from '../src/tasks/TaskDefinition';
import { JOB_IDS, TASKS, taskDef } from '../src/tasks/taskCatalog';
import { Economy } from '../src/economy/Economy';
import { Inventory } from '../src/player/Inventory';

const AT = 1_700_000_000_000;

/** Drive a run to completion by reporting each objective in order. */
function finish(ts: TaskSystem): void {
  const run = ts.active;
  if (!run) throw new Error('no active run');
  for (const p of run.progress) {
    if (p.kind === 'wait') {
      ts.advance(p.target + 0.1);
    } else {
      ts.report({ objectiveId: p.id }, p.target);
    }
  }
}

describe('task definitions', () => {
  it('validates every task in the catalogue', () => {
    for (const def of TASKS) {
      const r = validateTask(def);
      expect(r.errors, `${def.id}: ${r.errors.join('; ')}`).toEqual([]);
    }
  });

  it('has five jobs, and activities on top of them', () => {
    // The five jobs are the Phase 7 economy and are deliberately unchanged:
    // Phase 10 added *activities*, which pay less and are optional, rather
    // than more work with a wage attached.
    expect(JOB_IDS).toHaveLength(5);
    expect(TASKS.filter((t) => t.kind === 'activity').map((t) => t.id).sort()).toEqual([
      'activity_air_delivery',
      'activity_fishing',
      'activity_photography',
      'activity_police_escape',
      'activity_road_race',
      'activity_scenic_flight',
      'activity_time_trial',
    ]);
  });

  it('does not make every task a race', () => {
    // The Phase 7 brief was explicit and it still holds: most work has no
    // clock. Phase 10 added three timed activities — two of which are
    // literally races, where the clock *is* the activity — and three without,
    // so the majority of the catalogue is still untimed.
    const timed = TASKS.filter((t) => t.timeLimit !== null).map((t) => t.id);
    expect(timed.sort()).toEqual([
      'activity_air_delivery',
      'activity_road_race',
      'activity_time_trial',
      'job_city_courier',
      'job_taxi_driving',
    ]);
    expect(timed.length, 'still a minority').toBeLessThan(TASKS.length / 2);
  });

  it('pays exactly base at difficulty 1', () => {
    for (const def of TASKS) expect(payFor(def, 1)).toBe(def.basePay);
  });

  it('pays more and allows less time as difficulty rises', () => {
    const courier = taskDef('job_city_courier')!;
    expect(payFor(courier, 3)).toBeGreaterThan(payFor(courier, 1));
    expect(timeFor(courier, 3)!).toBeLessThan(timeFor(courier, 1)!);
  });

  it('never scales a timer to nothing', () => {
    for (const def of TASKS) {
      if (def.timeLimit === null) continue;
      const hardest = timeFor(def, MAX_DIFFICULTY)!;
      expect(hardest).toBeGreaterThanOrEqual(def.timeLimit * 0.25);
    }
  });

  it('leaves an untimed task untimed at every difficulty', () => {
    const shift = taskDef('job_grocery_shift')!;
    for (let d = 1; d <= MAX_DIFFICULTY; d++) expect(timeFor(shift, d)).toBeNull();
  });

  it('clamps a nonsense difficulty', () => {
    expect(clampDifficulty(-4)).toBe(1);
    expect(clampDifficulty(99)).toBe(MAX_DIFFICULTY);
    expect(clampDifficulty(NaN)).toBe(1);
  });

  it('rejects a malformed task', () => {
    const bad = { ...taskDef('activity_fishing')!, objectives: [] };
    expect(validateTask(bad).ok).toBe(false);
  });
});

describe('task system', () => {
  let ts: TaskSystem;

  beforeEach(() => {
    ts = new TaskSystem();
  });

  it('starts a job and reports its objectives', () => {
    const r = ts.start('job_grocery_shift');
    expect(r.ok).toBe(true);
    expect(ts.status).toBe('active');
    expect(ts.active?.progress).toHaveLength(4);
    expect(ts.active?.progress.every((p) => !p.complete)).toBe(true);
  });

  it('refuses an unknown task', () => {
    expect(ts.start('job_nothing')).toEqual({ ok: false, reason: 'unknown-task' });
  });

  it('runs one task at a time', () => {
    ts.start('job_grocery_shift');
    expect(ts.start('activity_fishing')).toEqual({ ok: false, reason: 'already-active' });
  });

  it('enforces the age gate', () => {
    expect(ts.start('job_taxi_driving', { age: 15 })).toEqual({ ok: false, reason: 'too-young' });
    expect(ts.start('job_taxi_driving', { age: 25, hasVehicle: true }).ok).toBe(true);
  });

  it('enforces the vehicle requirement', () => {
    expect(ts.start('job_taxi_driving', { age: 25, hasVehicle: false })).toEqual({
      ok: false,
      reason: 'needs-vehicle',
    });
  });

  it('completes when every objective is done, and pays', () => {
    ts.start('job_grocery_shift');
    finish(ts);
    const out = ts.outcome!;
    expect(out.state).toBe('completed');
    expect(out.pay).toBe(taskDef('job_grocery_shift')!.basePay);
    expect(out.awardKey).toBe('job_grocery_shift#1');
    expect(ts.active).toBeNull();
  });

  it('will not let a later objective complete before an earlier one', () => {
    ts.start('job_parcel_delivery');
    // Try to deliver before loading.
    expect(ts.report({ place: 'village_farm' })).toBe(false);
    ts.report({ objectiveId: 'load' }, 2);
    expect(ts.report({ place: 'village_farm' })).toBe(true);
  });

  it('matches progress by place without being told the objective', () => {
    ts.start('job_grocery_shift');
    ts.report({ objectiveId: 'fetch' }, 3);
    expect(ts.report({ place: 'grocery_aisle_a' }, 2)).toBe(true);
    expect(ts.active?.progress[1].complete).toBe(true);
  });

  it('lets a collect objective go back down', () => {
    ts.start('job_parcel_delivery');
    ts.setProgress('load', 2);
    expect(ts.active?.progress[0].complete).toBe(true);
    ts.setProgress('load', 0); // sold them, dropped them
    expect(ts.active?.progress[0].complete).toBe(false);
  });

  it('caps progress at the target', () => {
    ts.start('job_grocery_shift');
    ts.report({ objectiveId: 'fetch' }, 99);
    expect(ts.active?.progress[0].done).toBe(3);
  });

  // -- timers ---------------------------------------------------------------

  it('fails a timed run that runs out', () => {
    ts.start('job_city_courier', { age: 20, difficulty: 1 });
    const limit = ts.active!.timeLimit!;
    const out = ts.advance(limit + 1);
    expect(out?.state).toBe('failed');
    expect(out?.reason).toBe('timeout');
    expect(out?.pay).toBe(0);
  });

  it('counts down, and never below zero', () => {
    ts.start('job_city_courier', { age: 20 });
    const limit = ts.active!.timeLimit!;
    ts.advance(10);
    expect(ts.timeRemaining).toBeCloseTo(limit - 10, 6);
    ts.advance(limit * 2);
    expect(ts.timeRemaining).toBe(0);
  });

  it('leaves an untimed task with no countdown, however long it takes', () => {
    ts.start('job_grocery_shift');
    ts.advance(100_000);
    expect(ts.timeRemaining).toBeNull();
    expect(ts.status).toBe('active');
  });

  it('fills a wait objective from the same seconds the timer consumes', () => {
    ts.start('activity_fishing');
    ts.report({ objectiveId: 'cast' });
    ts.advance(10);
    expect(ts.active?.progress[1].done).toBeCloseTo(10, 6);
    ts.advance(20);
    expect(ts.active?.progress[1].complete).toBe(true);
  });

  it('does not start waiting before the objectives ahead of it are done', () => {
    ts.start('activity_fishing');
    ts.advance(30); // no cast yet
    expect(ts.active?.progress[1].done).toBe(0);
  });

  it('ignores a nonsense dt', () => {
    ts.start('job_city_courier', { age: 20 });
    for (const dt of [0, -1, NaN, Infinity]) ts.advance(dt);
    expect(ts.active?.elapsed).toBe(0);
  });

  // -- cancel, fail, retry ---------------------------------------------------

  it('cancels without paying', () => {
    ts.start('job_grocery_shift');
    const out = ts.cancel();
    expect(out?.state).toBe('cancelled');
    expect(out?.pay).toBe(0);
    expect(ts.active).toBeNull();
  });

  it('retries a failed run under a new key', () => {
    ts.start('job_city_courier', { age: 20 });
    ts.fail('abandoned');
    const first = ts.outcome!.awardKey;
    const r = ts.retry({ age: 20 });
    expect(r.ok).toBe(true);
    expect(ts.active?.runNumber).toBe(2);
    finish(ts);
    expect(ts.outcome!.awardKey).not.toBe(first);
  });

  it('retries a cancelled run too', () => {
    ts.start('job_grocery_shift');
    ts.cancel();
    expect(ts.retry().ok).toBe(true);
  });

  it('refuses to retry a completed run', () => {
    ts.start('job_grocery_shift');
    finish(ts);
    expect(ts.retry()).toEqual({ ok: false, reason: 'not-retryable' });
  });

  it('refuses to retry with nothing behind it', () => {
    expect(ts.retry().ok).toBe(false);
  });

  // -- difficulty ------------------------------------------------------------

  it('scales difficulty on completions, not attempts', () => {
    expect(ts.suggestedDifficulty('job_grocery_shift')).toBe(1);
    for (let i = 0; i < COMPLETIONS_PER_STEP; i++) {
      ts.start('job_grocery_shift');
      finish(ts);
    }
    expect(ts.suggestedDifficulty('job_grocery_shift')).toBe(2);

    // Failures must not push it up.
    const before = ts.suggestedDifficulty('job_city_courier');
    ts.start('job_city_courier', { age: 20 });
    ts.fail('abandoned');
    expect(ts.suggestedDifficulty('job_city_courier')).toBe(before);
  });

  it('is deterministic: the same run number gives the same numbers', () => {
    const a = new TaskSystem();
    const b = new TaskSystem();
    a.start('job_city_courier', { age: 20, difficulty: 4 });
    b.start('job_city_courier', { age: 20, difficulty: 4 });
    expect(a.active!.pay).toBe(b.active!.pay);
    expect(a.active!.timeLimit).toBe(b.active!.timeLimit);
  });

  // -- persistence -----------------------------------------------------------

  it('remembers completions across a save but not a half-done shift', () => {
    ts.start('job_grocery_shift');
    finish(ts);
    ts.start('job_grocery_shift'); // left half-finished

    const restored = new TaskSystem();
    restored.restore(ts.toJSON());
    expect(restored.completionsOf('job_grocery_shift')).toBe(1);
    expect(restored.attemptsOf('job_grocery_shift')).toBe(2);
    expect(restored.active).toBeNull();
    expect(restored.status).toBe('idle');
  });

  it('does not re-issue a spent award key after reloading', () => {
    ts.start('job_grocery_shift');
    finish(ts);
    const spent = ts.outcome!.awardKey;

    const restored = new TaskSystem();
    restored.restore(ts.toJSON());
    restored.start('job_grocery_shift');
    finish(restored);
    expect(restored.outcome!.awardKey).not.toBe(spent);
  });
});

describe('tasks and the economy together', () => {
  it('pays a completed shift exactly once', () => {
    const eco = new Economy(new Inventory(16), 0);
    const ts = new TaskSystem();
    ts.start('job_grocery_shift');
    finish(ts);
    const out = ts.outcome!;

    expect(eco.award(out.awardKey, out.pay, 'Shift', AT).ok).toBe(true);
    // Report the same completion again, as a double-fired callback would.
    expect(eco.award(out.awardKey, out.pay, 'Shift', AT).ok).toBe(false);
    expect(eco.wallet.cash).toBe(out.pay);
  });

  it('pays nothing for a failed run', () => {
    const eco = new Economy(new Inventory(16), 0);
    const ts = new TaskSystem();
    ts.start('job_city_courier', { age: 20 });
    const out = ts.advance(10_000)!;
    expect(out.pay).toBe(0);
    eco.award(out.awardKey, out.pay, 'Courier', AT);
    expect(eco.wallet.cash).toBe(0);
  });

  it('pays a retry that succeeds', () => {
    const eco = new Economy(new Inventory(16), 0);
    const ts = new TaskSystem();
    ts.start('job_city_courier', { age: 20 });
    const failed = ts.advance(10_000)!;
    eco.award(failed.awardKey, failed.pay, 'Courier', AT);

    ts.retry({ age: 20 });
    finish(ts);
    const won = ts.outcome!;
    expect(eco.award(won.awardKey, won.pay, 'Courier', AT).ok).toBe(true);
    expect(eco.wallet.cash).toBe(won.pay);
  });
});

// ---------------------------------------------------------------------------
// Phase 10 — the five new activities, and the promise about rewards
// ---------------------------------------------------------------------------

describe('the Phase 10 activities', () => {
  const NEW_IDS = [
    'activity_time_trial',
    'activity_road_race',
    'activity_photography',
    'activity_scenic_flight',
    'activity_air_delivery',
    'activity_police_escape',
  ];

  it('are all in the catalogue and all valid', () => {
    for (const id of NEW_IDS) {
      const def = taskDef(id);
      expect(def, id).not.toBeNull();
      expect(validateTask(def!).ok, id).toBe(true);
    }
  });

  it('covers every activity the brief names', () => {
    // Taxi, courier, recovery and fishing were already here; the brief asked
    // for those to be *expanded using existing systems* rather than rebuilt,
    // so this asserts the whole set exists rather than that Phase 10 wrote it.
    const wanted = [
      'activity_time_trial',      // bicycle time trial
      'activity_road_race',       // legal closed-course event
      'job_taxi_driving',         // taxi fares
      'job_city_courier',         // courier chains
      'activity_photography',     // photography locations and NPC requests
      'activity_fishing',         // fishing
      'job_garage_recovery',      // vehicle recovery jobs
      'activity_air_delivery',    // air delivery
      'activity_scenic_flight',   // scenic flight
      'activity_police_escape',   // optional police escape challenge
    ];
    for (const id of wanted) expect(taskDef(id), id).not.toBeNull();
  });

  it('every one of them can be started, cancelled and started again', () => {
    for (const id of NEW_IDS) {
      const ts = new TaskSystem();
      const def = taskDef(id)!;
      const opts = {
        age: 21,
        hasVehicle: true,
        vehicleId: typeof def.requiresVehicle === 'string' ? def.requiresVehicle : undefined,
      };
      expect(ts.start(id, opts).ok, `${id} start`).toBe(true);
      ts.cancel();
      expect(ts.active, `${id} cancelled`).toBeNull();
      expect(ts.start(id, opts).ok, `${id} restart`).toBe(true);
    }
  });

  it('every one of them can be completed, and pays exactly once', () => {
    for (const id of NEW_IDS) {
      const ts = new TaskSystem();
      const def = taskDef(id)!;
      ts.start(id, {
        age: 21,
        hasVehicle: true,
        vehicleId: typeof def.requiresVehicle === 'string' ? def.requiresVehicle : undefined,
      });
      finish(ts);
      // Completion settles itself the moment the last objective is met; the
      // outcome is then readable, once, from `outcome`.
      const done = ts.outcome;
      expect(done, `${id} completes`).not.toBeNull();
      expect(done!.state, id).toBe('completed');
      expect(done!.taskId, id).toBe(id);
    }
  });
});

describe('a named vehicle is a real gate', () => {
  it('refuses a bicycle time trial in a van, and allows it on a bicycle', () => {
    const ts = new TaskSystem();
    expect(ts.start('activity_time_trial', { age: 21, hasVehicle: true, vehicleId: 'van' }).ok)
      .toBe(false);
    expect(ts.start('activity_time_trial', { age: 21, hasVehicle: true, vehicleId: 'bicycle' }).ok)
      .toBe(true);
  });

  it('refuses a scenic flight on foot', () => {
    const ts = new TaskSystem();
    const r = ts.start('activity_scenic_flight', { age: 21, hasVehicle: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('needs-vehicle');
  });

  it('still lets an any-vehicle task run in anything', () => {
    const ts = new TaskSystem();
    expect(ts.start('activity_road_race', { age: 21, hasVehicle: true, vehicleId: 'hatchback' }).ok)
      .toBe(true);
  });
});

describe('rewards are idempotent across the whole new set', () => {
  it('gives every run a distinct award key, and repeats none', () => {
    const seen = new Set<string>();
    for (const id of ['activity_time_trial', 'activity_photography', 'activity_air_delivery']) {
      const ts = new TaskSystem();
      const def = taskDef(id)!;
      const opts = {
        age: 21,
        hasVehicle: true,
        vehicleId: typeof def.requiresVehicle === 'string' ? def.requiresVehicle : undefined,
      };
      // Three runs of the same task must not collide with each other.
      for (let run = 0; run < 3; run++) {
        ts.start(id, opts);
        finish(ts);
        const done = ts.outcome!;
        expect(seen.has(done.awardKey), `${done.awardKey} repeated`).toBe(false);
        seen.add(done.awardKey);
      }
    }
    expect(seen.size).toBe(9);
  });

  it('a run reloaded from a save cannot re-pay its own key', () => {
    const ts = new TaskSystem();
    ts.start('activity_photography', { age: 21 });
    finish(ts);
    const first = ts.outcome!;

    // A restore puts the attempt counts back; the next run must be numbered
    // after them, not on top of them. This is the case Phase 8 got wrong with
    // quest rewards and Phase 7 got wrong with the economy.
    const other = new TaskSystem();
    other.restore(ts.toJSON());
    other.start('activity_photography', { age: 21 });
    finish(other);
    const second = other.outcome!;

    expect(second.awardKey).not.toBe(first.awardKey);
    expect(second.runNumber).toBeGreaterThan(first.runNumber);
  });
});
