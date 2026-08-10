/**
 * Short repeatable work, as data.
 *
 * Deliberately **not** the quest system. A quest is a one-off with a place in
 * the story and a stage the save remembers forever; a task is a shift you can
 * do again tomorrow. Sharing one system would mean either quests that can be
 * repeated or jobs that can only be done once, and both are wrong.
 *
 * The brief's warning — "do not make every task a floating checkpoint race" —
 * is enforced by `timeLimit: null` being the default reading. Four of the six
 * have no timer at all. A grocery shift is not improved by a countdown; a
 * courier run genuinely is, because being quick is what the job *is*.
 */

export type TaskKind = 'job' | 'activity';

export type ObjectiveKind =
  /** Be within reach of a named place. */
  | 'goto'
  /** Hold N of an item, however you came by it. */
  | 'collect'
  /** Hand over N of an item at a named place. */
  | 'deliver'
  /** Use a named interaction point N times. */
  | 'interact'
  /** Stay put for N seconds. Fishing, waiting for a fare. */
  | 'wait';

export interface Objective {
  readonly id: string;
  readonly kind: ObjectiveKind;
  readonly label: string;
  /** Target for collect/deliver/interact. Defaults to 1. */
  readonly count?: number;
  /** Resolved to a world position by the host, not by this module. */
  readonly place?: string;
  readonly itemId?: string;
  /** For `wait`. */
  readonly seconds?: number;
}

export interface TaskDef {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly kind: TaskKind;
  readonly objectives: readonly Objective[];
  /**
   * Seconds, or null for no timer.
   *
   * Null is the common case on purpose. See the note at the top.
   */
  readonly timeLimit: number | null;
  readonly basePay: number;
  /**
   * How difficulty moves the numbers, per step above 1.
   *
   * `pay` is a fraction of base added per step; `time` a fraction of the
   * limit removed. Both are applied from difficulty 1, so difficulty 1 is
   * always exactly the base figures — which is what makes the balance sheet
   * readable.
   */
  readonly scaling: { readonly pay: number; readonly time: number };
  /** Can a failed run be attempted again? */
  readonly retryable: boolean;
  /** Interaction point id where the player signs up. */
  readonly startPoint: string;
  /** Blocks the task below this age. Nothing here is combat. */
  readonly minAge?: number;
  /**
   * What the player has to be sitting in.
   *
   * `true` means "any vehicle", which is what the taxi and recovery jobs have
   * always meant. Phase 10 adds the named form: a bicycle time trial run in a
   * van is not a bicycle time trial, and a scenic flight on foot is a walk.
   * The host resolves the id against the vehicle it is actually driving, so
   * this file still knows nothing about vehicles.
   */
  readonly requiresVehicle?: boolean | string;
}

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

export function clampDifficulty(d: number): number {
  if (!Number.isFinite(d)) return MIN_DIFFICULTY;
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Math.round(d)));
}

/** Pay for a run at this difficulty, in whole dollars. */
export function payFor(def: TaskDef, difficulty: number): number {
  const steps = clampDifficulty(difficulty) - 1;
  return Math.max(0, Math.round(def.basePay * (1 + def.scaling.pay * steps)));
}

/**
 * Time allowed at this difficulty, or null.
 *
 * Floored at a quarter of the base limit: scaling that can reach zero turns a
 * hard run into an impossible one, and "impossible" is not a difficulty.
 */
export function timeFor(def: TaskDef, difficulty: number): number | null {
  if (def.timeLimit === null) return null;
  const steps = clampDifficulty(difficulty) - 1;
  const scaled = def.timeLimit * (1 - def.scaling.time * steps);
  return Math.max(def.timeLimit * 0.25, Math.round(scaled));
}

export function objectiveTarget(o: Objective): number {
  if (o.kind === 'wait') return Math.max(1, o.seconds ?? 1);
  return Math.max(1, o.count ?? 1);
}

export interface TaskValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateTask(def: TaskDef): TaskValidation {
  const errors: string[] = [];
  if (def.objectives.length === 0) errors.push(`${def.id}: has no objectives`);

  const ids = new Set<string>();
  for (const o of def.objectives) {
    if (ids.has(o.id)) errors.push(`${def.id}: duplicate objective ${o.id}`);
    ids.add(o.id);
    if ((o.kind === 'collect' || o.kind === 'deliver') && !o.itemId) {
      errors.push(`${def.id}: ${o.id} is a ${o.kind} with no item`);
    }
    if ((o.kind === 'goto' || o.kind === 'deliver' || o.kind === 'interact') && !o.place) {
      errors.push(`${def.id}: ${o.id} is a ${o.kind} with no place`);
    }
    if (o.kind === 'wait' && !o.seconds) errors.push(`${def.id}: ${o.id} waits for no time`);
  }

  if (def.basePay < 0) errors.push(`${def.id}: negative pay`);
  if (!Number.isSafeInteger(def.basePay)) errors.push(`${def.id}: pay is not whole dollars`);
  if (def.timeLimit !== null && def.timeLimit <= 0) errors.push(`${def.id}: non-positive timer`);
  if (def.scaling.time >= 0.25) errors.push(`${def.id}: time scaling would outrun the floor`);

  return { ok: errors.length === 0, errors };
}
