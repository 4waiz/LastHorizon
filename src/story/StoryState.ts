import {
  NEUTRAL_REPUTATION,
  REPUTATION_AXES,
  type ReelEventKind,
  type Reputation,
  type ReputationAxis,
} from './QuestDefinition';

/**
 * Everything the story remembers, and nothing that runs it.
 *
 * This is the eager half. `QuestSystem`, the authored catalogue, the dialogue
 * trees, the cutscenes and the Life Reel renderer are all behind a dynamic
 * import — but the *save layer* has to read and write story progress whether
 * or not anybody has loaded a quest, exactly as `RelationshipStore` lives
 * above `Population` because a village friendship has to survive a trip to the
 * city.
 *
 * So this file is deliberately dull: a bag of flags, a bag of choices, two
 * reputation numbers, an append-only reel and a map of quest positions. No
 * catalogue, no Three.js, no clock. It is the thing a save is made of.
 */

export interface ReelEvent {
  readonly kind: ReelEventKind;
  /** Age at which it happened, to one decimal. The reel is a timeline. */
  readonly age: number;
  /** Localisation key. The reel renders text from the string table. */
  readonly textKey: string;
  /** Free-form detail already safe to display — a name, an amount. */
  readonly detail?: string;
}

export interface QuestRunData {
  readonly id: string;
  readonly stage: string;
  /** Objective id -> progress. Absent objectives are at zero. */
  readonly progress: Record<string, number>;
  readonly state: QuestRunState;
  /** Active seconds spent on the current stage, for stage time limits. */
  readonly elapsed: number;
}

export type QuestRunState = 'active' | 'completed' | 'failed' | 'abandoned';

export interface StoryStateData {
  flags: string[];
  choices: Record<string, string>;
  reputation: Reputation;
  reel: ReelEvent[];
  quests: QuestRunData[];
  /** Award keys already paid. What makes a reward idempotent across a reload. */
  paidRewards: string[];
  endingId: string | null;
}

const MAX_REEL_EVENTS = 240;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Reputation is clamped to 0..1 on both axes.
 *
 * Unbounded reputation is how an ending threshold stops meaning anything: a
 * player who did every side task arrives at chapter 7 with a number no
 * condition can fail, and every variant collapses to the same one.
 */
function clampReputation(r: Reputation): Reputation {
  return { community: clamp01(r.community), law: clamp01(r.law) };
}

export class StoryState {
  private readonly flagSet = new Set<string>();
  private readonly choiceMap = new Map<string, string>();
  private reputationValue: Reputation = { ...NEUTRAL_REPUTATION };
  private reelEvents: ReelEvent[] = [];
  private readonly runs = new Map<string, QuestRunData>();
  private readonly paid = new Set<string>();
  private ending: string | null = null;

  // -- flags ---------------------------------------------------------------

  has(flag: string): boolean {
    return this.flagSet.has(flag);
  }

  setFlag(flag: string): void {
    this.flagSet.add(flag);
  }

  clearFlag(flag: string): void {
    this.flagSet.delete(flag);
  }

  get flags(): ReadonlySet<string> {
    return this.flagSet;
  }

  // -- choices -------------------------------------------------------------

  /**
   * Record an authored choice.
   *
   * First write wins. A choice the story asked once and the player answered
   * once must not change because a stage was replayed after a reload — that is
   * the difference between a decision and a setting.
   */
  choose(id: string, value: string): boolean {
    if (this.choiceMap.has(id)) return false;
    this.choiceMap.set(id, value);
    return true;
  }

  choice(id: string): string | null {
    return this.choiceMap.get(id) ?? null;
  }

  get choices(): ReadonlyMap<string, string> {
    return this.choiceMap;
  }

  // -- reputation ----------------------------------------------------------

  get reputation(): Readonly<Reputation> {
    return this.reputationValue;
  }

  adjustReputation(axis: ReputationAxis, delta: number): void {
    if (!Number.isFinite(delta)) return;
    this.reputationValue = clampReputation({
      ...this.reputationValue,
      [axis]: this.reputationValue[axis] + delta,
    });
  }

  // -- the reel ------------------------------------------------------------

  /**
   * Append a moment.
   *
   * Capped, and the cap drops the *oldest* non-birthday entries first: a run
   * long enough to overflow is a run whose birthdays are the spine of the
   * timeline, and losing "you turned 18" to make room for a delivery would
   * make the reel unreadable in exactly the case it matters most.
   */
  recordReel(event: ReelEvent): void {
    this.reelEvents.push(event);
    if (this.reelEvents.length <= MAX_REEL_EVENTS) return;

    const firstOrdinary = this.reelEvents.findIndex(
      (e) => e.kind !== 'birthday' && e.kind !== 'ending' && e.kind !== 'chapter',
    );
    this.reelEvents.splice(firstOrdinary >= 0 ? firstOrdinary : 0, 1);
  }

  get reel(): readonly ReelEvent[] {
    return this.reelEvents;
  }

  // -- quest positions -----------------------------------------------------

  run(questId: string): QuestRunData | null {
    return this.runs.get(questId) ?? null;
  }

  setRun(data: QuestRunData): void {
    this.runs.set(data.id, data);
  }

  get allRuns(): readonly QuestRunData[] {
    return [...this.runs.values()];
  }

  isComplete(questId: string): boolean {
    return this.runs.get(questId)?.state === 'completed';
  }

  // -- rewards -------------------------------------------------------------

  hasPaid(key: string): boolean {
    return this.paid.has(key);
  }

  /** Claim a key. False when it was already spent, which is the whole point. */
  claim(key: string): boolean {
    if (this.paid.has(key)) return false;
    this.paid.add(key);
    return true;
  }

  /** Give a key back, for a transaction that was rolled back. */
  release(key: string): void {
    this.paid.delete(key);
  }

  // -- the ending ----------------------------------------------------------

  get endingId(): string | null {
    return this.ending;
  }

  setEnding(id: string): void {
    this.ending = id;
  }

  // -- persistence ---------------------------------------------------------

  toJSON(): StoryStateData {
    return {
      flags: [...this.flagSet].sort(),
      choices: Object.fromEntries([...this.choiceMap].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
      reputation: { ...this.reputationValue },
      reel: this.reelEvents.map((e) => ({ ...e })),
      quests: this.allRuns
        .map((r) => ({ ...r, progress: { ...r.progress } }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      paidRewards: [...this.paid].sort(),
      endingId: this.ending,
    };
  }

  /**
   * Restore from a save, defensively.
   *
   * Every field is optional and every one has a default that reads as a
   * plausible run rather than a broken one — the same discipline the save
   * migrations already use. A save written before this phase existed restores
   * as "nothing has happened yet", which is exactly what it means.
   */
  restore(data: Partial<StoryStateData> | undefined): void {
    this.flagSet.clear();
    for (const f of data?.flags ?? []) if (typeof f === 'string') this.flagSet.add(f);

    this.choiceMap.clear();
    for (const [k, v] of Object.entries(data?.choices ?? {})) {
      if (typeof v === 'string') this.choiceMap.set(k, v);
    }

    const rep = data?.reputation;
    this.reputationValue = clampReputation({
      community: numberOr(rep?.community, NEUTRAL_REPUTATION.community),
      law: numberOr(rep?.law, NEUTRAL_REPUTATION.law),
    });

    this.reelEvents = (data?.reel ?? [])
      .filter((e): e is ReelEvent => typeof e?.textKey === 'string' && Number.isFinite(e?.age))
      .map((e) => ({ ...e }))
      .slice(-MAX_REEL_EVENTS);

    this.runs.clear();
    for (const r of data?.quests ?? []) {
      if (typeof r?.id !== 'string' || typeof r?.stage !== 'string') continue;
      this.runs.set(r.id, {
        id: r.id,
        stage: r.stage,
        progress: { ...(r.progress ?? {}) },
        state: r.state ?? 'active',
        elapsed: numberOr(r.elapsed, 0),
      });
    }

    this.paid.clear();
    for (const k of data?.paidRewards ?? []) if (typeof k === 'string') this.paid.add(k);

    this.ending = typeof data?.endingId === 'string' ? data.endingId : null;
  }

  /** Back to a fresh run. Used when starting a new game in the same session. */
  reset(): void {
    this.restore(undefined);
  }

  /**
   * A snapshot for rollback, matching `Economy.snapshot`.
   *
   * The paid-reward keys are in it for the reason the economy's are: rolling
   * back a payment without releasing its key leaves a completed stage that can
   * never be paid.
   */
  snapshot(): StoryStateData {
    return this.toJSON();
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Axis list re-exported so callers need one import for a reputation loop. */
export { REPUTATION_AXES };
