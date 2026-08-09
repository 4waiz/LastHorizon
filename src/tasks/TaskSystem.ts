import {
  clampDifficulty,
  objectiveTarget,
  payFor,
  timeFor,
  type Objective,
  type TaskDef,
} from './TaskDefinition';
import { taskDef } from './taskCatalog';

/**
 * Running one short job at a time.
 *
 * **Reads no clock.** Time arrives through `advance(dt)`, exactly like the
 * life clock and the needs, which is what makes a five-minute courier run
 * testable in five lines rather than five minutes. Difficulty is supplied by
 * the caller or derived from how many times the job has been done — never
 * from `Math.random`, so a test that asks for run 3 gets run 3's numbers.
 *
 * One task is active at a time. A player doing a taxi shift and a grocery
 * shift simultaneously is not a feature, it is two half-finished HUD trackers
 * and an argument about which one the reward belongs to.
 */

export type TaskState = 'idle' | 'active' | 'completed' | 'failed' | 'cancelled';

export type FailReason = 'timeout' | 'abandoned' | 'lost-goods' | 'host';

export type StartRefusal =
  | 'unknown-task'
  | 'already-active'
  | 'too-young'
  | 'needs-vehicle'
  | 'not-retryable';

export type StartResult =
  | { readonly ok: true; readonly run: ActiveRun }
  | { readonly ok: false; readonly reason: StartRefusal };

export interface ObjectiveProgress {
  readonly id: string;
  readonly label: string;
  readonly kind: Objective['kind'];
  readonly done: number;
  readonly target: number;
  readonly complete: boolean;
  readonly place?: string;
  readonly itemId?: string;
}

export interface ActiveRun {
  readonly def: TaskDef;
  /** 1 for the first attempt of this task in this save. */
  readonly runNumber: number;
  readonly difficulty: number;
  readonly pay: number;
  /** Seconds, or null when the task has no timer. */
  readonly timeLimit: number | null;
  elapsed: number;
  readonly progress: ObjectiveProgress[];
}

export interface TaskOutcome {
  readonly taskId: string;
  readonly runNumber: number;
  readonly state: Exclude<TaskState, 'idle' | 'active'>;
  readonly pay: number;
  /**
   * The idempotency key for `Economy.award`.
   *
   * Carries the run number, so the same completion reported twice pays once
   * and a second run of the same job pays again.
   */
  readonly awardKey: string;
  readonly reason?: FailReason;
}

export interface StartOptions {
  /** 1..5. Defaults to scaling with how often the task has been completed. */
  readonly difficulty?: number;
  readonly age?: number;
  readonly hasVehicle?: boolean;
}

export interface TaskSystemData {
  /** Completed runs per task id, which is what difficulty scales on. */
  completions: Record<string, number>;
  /** Attempts per task id, which is what the award key counts. */
  attempts: Record<string, number>;
}

/** Every fourth completion moves the difficulty up a step. */
export const COMPLETIONS_PER_STEP = 4;

export class TaskSystem {
  private run: ActiveRun | null = null;
  private state: TaskState = 'idle';
  private completions = new Map<string, number>();
  private attempts = new Map<string, number>();
  private lastOutcome: TaskOutcome | null = null;

  get active(): ActiveRun | null {
    return this.state === 'active' ? this.run : null;
  }

  get status(): TaskState {
    return this.state;
  }

  get outcome(): TaskOutcome | null {
    return this.lastOutcome;
  }

  completionsOf(taskId: string): number {
    return this.completions.get(taskId) ?? 0;
  }

  attemptsOf(taskId: string): number {
    return this.attempts.get(taskId) ?? 0;
  }

  /** Seconds left, or null when there is no timer. Never negative. */
  get timeRemaining(): number | null {
    if (!this.run || this.run.timeLimit === null) return null;
    return Math.max(0, this.run.timeLimit - this.run.elapsed);
  }

  /**
   * Difficulty this task would start at right now.
   *
   * A function of completions, so it is the same before and after a reload
   * and the same in a test as in the game.
   */
  suggestedDifficulty(taskId: string): number {
    return clampDifficulty(1 + Math.floor(this.completionsOf(taskId) / COMPLETIONS_PER_STEP));
  }

  start(taskId: string, opts: StartOptions = {}): StartResult {
    if (this.state === 'active') return { ok: false, reason: 'already-active' };

    const def = taskDef(taskId);
    if (!def) return { ok: false, reason: 'unknown-task' };

    if (def.minAge !== undefined && (opts.age ?? Infinity) < def.minAge) {
      return { ok: false, reason: 'too-young' };
    }
    if (def.requiresVehicle && opts.hasVehicle === false) {
      return { ok: false, reason: 'needs-vehicle' };
    }

    const difficulty = clampDifficulty(opts.difficulty ?? this.suggestedDifficulty(taskId));
    const attempt = this.attemptsOf(taskId) + 1;
    this.attempts.set(taskId, attempt);

    this.run = {
      def,
      runNumber: attempt,
      difficulty,
      pay: payFor(def, difficulty),
      timeLimit: timeFor(def, difficulty),
      elapsed: 0,
      progress: def.objectives.map((o) => ({
        id: o.id,
        label: o.label,
        kind: o.kind,
        done: 0,
        target: objectiveTarget(o),
        complete: false,
        place: o.place,
        itemId: o.itemId,
      })),
    };
    this.state = 'active';
    this.lastOutcome = null;
    return { ok: true, run: this.run };
  }

  /**
   * Advance the clock and any `wait` objective.
   *
   * A `wait` fills from the same seconds the timer consumes, so "wait 25 s"
   * and "you have 240 s" cannot drift apart the way two separate accumulators
   * would.
   */
  advance(dt: number): TaskOutcome | null {
    if (this.state !== 'active' || !this.run || !Number.isFinite(dt) || dt <= 0) return null;

    this.run.elapsed += dt;

    for (let i = 0; i < this.run.progress.length; i++) {
      const p = this.run.progress[i];
      if (p.kind !== 'wait' || p.complete) continue;
      // Objectives complete in order: waiting only starts once everything
      // before it is done, or fishing would land a fish before casting.
      if (!this.earlierObjectivesDone(i)) continue;
      const done = Math.min(p.target, p.done + dt);
      this.run.progress[i] = { ...p, done, complete: done >= p.target };
    }

    if (this.run.timeLimit !== null && this.run.elapsed >= this.run.timeLimit) {
      return this.fail('timeout');
    }
    return this.settleIfDone();
  }

  private earlierObjectivesDone(index: number): boolean {
    if (!this.run) return false;
    for (let i = 0; i < index; i++) if (!this.run.progress[i].complete) return false;
    return true;
  }

  /**
   * Report progress on an objective.
   *
   * Matched on objective id first, then on place, then on item — so a host
   * can say "the player used grocery_aisle_a" without knowing which objective
   * that satisfies. Progress on an out-of-order objective is ignored rather
   * than banked, which is what keeps a delivery from completing before the
   * pickup.
   */
  report(what: { objectiveId?: string; place?: string; itemId?: string }, amount = 1): boolean {
    if (this.state !== 'active' || !this.run || amount <= 0) return false;

    const index = this.run.progress.findIndex((p, i) => {
      if (p.complete) return false;
      if (!this.earlierObjectivesDone(i)) return false;
      if (what.objectiveId !== undefined) return p.id === what.objectiveId;
      if (what.place !== undefined && p.place === what.place) return true;
      if (what.itemId !== undefined && p.itemId === what.itemId && p.place === undefined) {
        return true;
      }
      return false;
    });
    if (index < 0) return false;

    const p = this.run.progress[index];
    const done = Math.min(p.target, p.done + amount);
    this.run.progress[index] = { ...p, done, complete: done >= p.target };
    this.settleIfDone();
    return true;
  }

  /**
   * Set an objective's progress absolutely.
   *
   * For `collect`, whose truth is how many the player is holding right now —
   * an item dropped or sold mid-run has to be able to move the bar *down*.
   */
  setProgress(objectiveId: string, done: number): boolean {
    if (this.state !== 'active' || !this.run) return false;
    const index = this.run.progress.findIndex((p) => p.id === objectiveId);
    if (index < 0) return false;
    const p = this.run.progress[index];
    const clamped = Math.max(0, Math.min(p.target, done));
    this.run.progress[index] = { ...p, done: clamped, complete: clamped >= p.target };
    this.settleIfDone();
    return true;
  }

  private settleIfDone(): TaskOutcome | null {
    if (!this.run || this.state !== 'active') return null;
    if (!this.run.progress.every((p) => p.complete)) return null;

    const { def, runNumber, pay } = this.run;
    this.completions.set(def.id, this.completionsOf(def.id) + 1);
    this.state = 'completed';
    this.lastOutcome = {
      taskId: def.id,
      runNumber,
      state: 'completed',
      pay,
      awardKey: `${def.id}#${runNumber}`,
    };
    return this.lastOutcome;
  }

  fail(reason: FailReason): TaskOutcome | null {
    if (this.state !== 'active' || !this.run) return null;
    const { def, runNumber } = this.run;
    this.state = 'failed';
    this.lastOutcome = {
      taskId: def.id,
      runNumber,
      state: 'failed',
      pay: 0,
      awardKey: `${def.id}#${runNumber}`,
      reason,
    };
    return this.lastOutcome;
  }

  /** Walking away. Distinct from failure: nothing went wrong, you stopped. */
  cancel(): TaskOutcome | null {
    if (this.state !== 'active' || !this.run) return null;
    const { def, runNumber } = this.run;
    this.state = 'cancelled';
    this.lastOutcome = {
      taskId: def.id,
      runNumber,
      state: 'cancelled',
      pay: 0,
      awardKey: `${def.id}#${runNumber}`,
    };
    return this.lastOutcome;
  }

  /**
   * Try the last task again.
   *
   * A fresh run number, so the retry can be paid — the failed attempt never
   * was. Refused for a task marked `retryable: false`, and refused outright
   * after a completion, which is a new job rather than a retry.
   */
  retry(opts: StartOptions = {}): StartResult {
    const last = this.lastOutcome;
    if (!last) return { ok: false, reason: 'unknown-task' };
    if (last.state === 'completed') return { ok: false, reason: 'not-retryable' };

    const def = taskDef(last.taskId);
    if (!def) return { ok: false, reason: 'unknown-task' };
    if (!def.retryable) return { ok: false, reason: 'not-retryable' };

    this.state = 'idle';
    this.run = null;
    return this.start(last.taskId, opts);
  }

  /** Back to nothing running. Does not clear history. */
  clear(): void {
    this.state = 'idle';
    this.run = null;
  }

  toJSON(): TaskSystemData {
    return {
      completions: Object.fromEntries(this.completions),
      attempts: Object.fromEntries(this.attempts),
    };
  }

  /**
   * Restore counters only.
   *
   * A half-finished shift is deliberately *not* saved. Restoring one would
   * mean restoring the state of the shop, the boxes carried and the fares
   * waiting — and a job you can do again in two minutes is not worth a save
   * format that can be wrong about all three.
   */
  restore(data: Partial<TaskSystemData>): void {
    this.completions = new Map(Object.entries(data.completions ?? {}));
    this.attempts = new Map(Object.entries(data.attempts ?? {}));
    this.state = 'idle';
    this.run = null;
    this.lastOutcome = null;
  }
}
