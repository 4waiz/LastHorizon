import {
  checkpointBefore,
  objectiveTarget,
  requiredObjectives,
  rewardKey,
  stageOf,
  type Consequence,
  type QuestDef,
  type QuestObjective,
  type QuestReward,
  type QuestStage,
  type StoryCondition,
} from './QuestDefinition';
import type { ReelEvent, QuestRunData, StoryState } from './StoryState';
import type { RelationshipAxes } from '../npc/Relationships';
import type { ZoneId } from '../world/zones/Manifest';
import type { GameMode } from '../core/Gates';

/**
 * Running the authored story.
 *
 * Like `TaskSystem`, this **reads no clock and touches no DOM**. Seconds
 * arrive through `advance(dt)` and everything else arrives through the host,
 * so a seven-chapter story is testable in milliseconds and a stage timer does
 * not need a browser to expire.
 *
 * Unlike `TaskSystem`, several quests run at once. A side task taken from a
 * neighbour must not be cancelled by the main story moving on, and the main
 * story must not wait for it — so runs are a map, not a slot.
 *
 * The one invariant worth stating up front: **every mutation of story state
 * goes through here.** Nothing else applies a consequence, pays a reward, or
 * moves a stage. That is what makes "no quest logic hidden in UI components"
 * checkable rather than aspirational — a panel can only ask this class to do
 * something, and there is one place to look when it does the wrong thing.
 */

/** What the runtime cannot know on its own. */
export interface StoryHost {
  readonly age: number;
  readonly money: number;
  readonly mode: GameMode;
  relationship(npcId: string): RelationshipAxes;
  adjustRelationship(npcId: string, axes: Partial<RelationshipAxes>): void;
  unlockZone(zone: ZoneId): void;
  completeChapter(id: string): void;
  /** Pay money and hand over items. False when it could not be given in full. */
  grant(reward: QuestReward, key: string): boolean;
  /** Chapter, for the reel's timeline. */
  readonly chapter: number;
}

export type StartRefusal =
  | 'unknown-quest'
  | 'already-running'
  | 'already-complete'
  | 'prerequisites'
  | 'too-young'
  | 'too-old'
  | 'wrong-mode';

export type StartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: StartRefusal };

export interface ObjectiveView {
  readonly id: string;
  readonly kind: QuestObjective['kind'];
  readonly labelKey: string;
  readonly done: number;
  readonly target: number;
  readonly complete: boolean;
  readonly optional: boolean;
  readonly place?: string;
  readonly npcId?: string;
  readonly itemId?: string;
  readonly zone?: ZoneId;
}

export interface QuestView {
  readonly id: string;
  readonly titleKey: string;
  readonly kind: QuestDef['kind'];
  readonly chapter: number;
  readonly stageId: string;
  readonly stageTitleKey: string;
  readonly hintKey?: string;
  readonly objectives: readonly ObjectiveView[];
  readonly timeRemaining: number | null;
  readonly abandonable: boolean;
}

/** Something the host should present. Returned, never fired as a callback. */
export type StoryEvent =
  | { readonly kind: 'stage'; readonly questId: string; readonly stageId: string;
      readonly sceneId?: string; readonly dialogueId?: string }
  | { readonly kind: 'completed'; readonly questId: string; readonly outcomeKey?: string }
  | { readonly kind: 'failed'; readonly questId: string; readonly messageKey?: string }
  | { readonly kind: 'started'; readonly questId: string }
  | { readonly kind: 'reward'; readonly questId: string; readonly money: number };

/** What a progress report carries. Matched loosely, like `TaskSystem.report`. */
export interface ProgressReport {
  readonly objectiveId?: string;
  readonly kind?: QuestObjective['kind'];
  readonly place?: string;
  readonly npcId?: string;
  readonly itemId?: string;
  readonly zone?: ZoneId;
  readonly taskId?: string;
  readonly serviceOffer?: string;
}

export class QuestSystem {
  /** Drained by the host each frame. */
  private readonly events: StoryEvent[] = [];

  constructor(
    private readonly state: StoryState,
    private readonly lookup: (id: string) => QuestDef | null,
    private readonly host: StoryHost,
    /** Every authored quest, so `available()` can enumerate. */
    private readonly allDefs: () => readonly QuestDef[] = () => [],
  ) {}

  // -- reading -------------------------------------------------------------

  /** Every quest currently in progress, in authored chapter order. */
  activeQuests(): QuestView[] {
    const out: QuestView[] = [];
    for (const run of this.state.allRuns) {
      if (run.state !== 'active') continue;
      const view = this.viewOf(run);
      if (view) out.push(view);
    }
    return out.sort((a, b) => a.chapter - b.chapter || (a.id < b.id ? -1 : 1));
  }

  view(questId: string): QuestView | null {
    const run = this.state.run(questId);
    return run && run.state === 'active' ? this.viewOf(run) : null;
  }

  private viewOf(run: QuestRunData): QuestView | null {
    const def = this.lookup(run.id);
    if (!def) return null;
    const stage = stageOf(def, run.stage);
    if (!stage) return null;

    return {
      id: def.id,
      titleKey: def.titleKey,
      kind: def.kind,
      chapter: def.chapter,
      stageId: stage.id,
      stageTitleKey: stage.titleKey,
      hintKey: stage.hintKey,
      objectives: stage.objectives.map((o) => {
        const target = objectiveTarget(o);
        const done = Math.min(target, run.progress[o.id] ?? 0);
        return {
          id: o.id,
          kind: o.kind,
          labelKey: o.labelKey,
          done,
          target,
          complete: done >= target,
          optional: o.optional === true,
          place: o.place,
          npcId: o.npcId,
          itemId: o.itemId,
          zone: o.zone,
        };
      }),
      timeRemaining:
        stage.fail?.timeLimit != null ? Math.max(0, stage.fail.timeLimit - run.elapsed) : null,
      abandonable: def.abandonable,
    };
  }

  /** Quests that could be started right now. */
  available(): QuestDef[] {
    const out: QuestDef[] = [];
    for (const def of this.allDefs()) {
      if (this.state.run(def.id)) continue;
      if (this.canStart(def).ok) out.push(def);
    }
    return out;
  }

  drainEvents(): StoryEvent[] {
    const out = [...this.events];
    this.events.length = 0;
    return out;
  }

  // -- starting ------------------------------------------------------------

  private canStart(def: QuestDef): StartResult {
    const run = this.state.run(def.id);
    if (run?.state === 'active') return { ok: false, reason: 'already-running' };
    if (run?.state === 'completed') return { ok: false, reason: 'already-complete' };

    if (def.mode !== undefined && def.mode !== this.host.mode) {
      return { ok: false, reason: 'wrong-mode' };
    }
    if (def.minAge !== undefined && this.host.age < def.minAge) {
      return { ok: false, reason: 'too-young' };
    }
    if (def.maxAge !== undefined && this.host.age > def.maxAge) {
      return { ok: false, reason: 'too-old' };
    }
    for (const need of def.requires ?? []) {
      if (!this.state.isComplete(need)) return { ok: false, reason: 'prerequisites' };
    }
    return { ok: true };
  }

  start(questId: string): StartResult {
    const def = this.lookup(questId);
    if (!def) return { ok: false, reason: 'unknown-quest' };

    const allowed = this.canStart(def);
    if (!allowed.ok) return allowed;

    this.state.setRun({
      id: def.id,
      stage: def.startStage,
      progress: {},
      state: 'active',
      elapsed: 0,
    });
    this.events.push({ kind: 'started', questId: def.id });
    this.enterStage(def, def.startStage, { replay: false });
    return { ok: true };
  }

  // -- progress ------------------------------------------------------------

  /**
   * Report progress against whatever objective it fits.
   *
   * Quest objectives do **not** complete strictly in order the way task
   * objectives do. A chapter that says "talk to three neighbours" should not
   * care which door you knock on first, and forcing an order there would make
   * a village feel like a corridor. Where order genuinely matters — pick the
   * parcel up before delivering it — it is expressed as two *stages*, which is
   * what stages are for.
   */
  report(questId: string, what: ProgressReport, amount = 1): boolean {
    const run = this.state.run(questId);
    if (!run || run.state !== 'active' || amount <= 0) return false;

    const def = this.lookup(questId);
    const stage = def ? stageOf(def, run.stage) : null;
    if (!def || !stage) return false;

    const objective = stage.objectives.find((o) => matches(o, what, run.progress));
    if (!objective) return false;

    return this.applyProgress(def, stage, run, objective.id, (prev) => prev + amount);
  }

  /** Report against every active quest. What the host calls for world events. */
  reportAll(what: ProgressReport, amount = 1): number {
    let hits = 0;
    for (const run of this.state.allRuns) {
      if (run.state !== 'active') continue;
      if (this.report(run.id, what, amount)) hits++;
    }
    return hits;
  }

  /**
   * Set an objective's progress absolutely.
   *
   * For `collect`, whose truth is how many the player holds right now — an
   * item sold or dropped mid-stage has to move the bar back down. Phase 7
   * learned this the expensive way: items arrive from a shop, a pickup, a
   * reward and a save restore, and pushing at each source is four chances to
   * miss one.
   */
  setProgress(questId: string, objectiveId: string, done: number): boolean {
    const run = this.state.run(questId);
    if (!run || run.state !== 'active') return false;
    const def = this.lookup(questId);
    const stage = def ? stageOf(def, run.stage) : null;
    if (!def || !stage) return false;
    if (!stage.objectives.some((o) => o.id === objectiveId)) return false;

    return this.applyProgress(def, stage, run, objectiveId, () => done);
  }

  private applyProgress(
    def: QuestDef,
    stage: QuestStage,
    run: QuestRunData,
    objectiveId: string,
    next: (prev: number) => number,
  ): boolean {
    const objective = stage.objectives.find((o) => o.id === objectiveId);
    if (!objective) return false;

    const target = objectiveTarget(objective);
    const value = Math.max(0, Math.min(target, next(run.progress[objectiveId] ?? 0)));
    if (value === (run.progress[objectiveId] ?? 0)) return false;

    this.state.setRun({ ...run, progress: { ...run.progress, [objectiveId]: value } });
    this.settle(def);
    return true;
  }

  /**
   * Advance stage timers and the objectives that fill with time.
   *
   * `wait` and `follow` draw from the same seconds the stage timer consumes,
   * so "wait 25 s" and "you have 240 s" cannot drift apart the way two
   * accumulators would.
   */
  advance(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    for (const run of this.state.allRuns) {
      if (run.state !== 'active') continue;
      const def = this.lookup(run.id);
      const stage = def ? stageOf(def, run.stage) : null;
      if (!def || !stage) continue;

      const elapsed = run.elapsed + dt;
      const progress = { ...run.progress };
      let touched = false;

      for (const o of stage.objectives) {
        if (o.kind !== 'wait') continue;
        const target = objectiveTarget(o);
        const done = Math.min(target, (progress[o.id] ?? 0) + dt);
        if (done !== progress[o.id]) {
          progress[o.id] = done;
          touched = true;
        }
      }

      this.state.setRun({ ...run, elapsed, progress: touched ? progress : run.progress });

      const limit = stage.fail?.timeLimit;
      if (limit != null && elapsed >= limit) {
        this.failStage(def, stage);
        continue;
      }
      if (touched) this.settle(def);
    }
  }

  // -- transitions ---------------------------------------------------------

  /**
   * Move on if the stage is done.
   *
   * Optional objectives are checked for *rewards* but never for completion,
   * which is the whole distinction — an optional objective that gates progress
   * is a required one wearing a disguise.
   */
  private settle(def: QuestDef): void {
    const run = this.state.run(def.id);
    if (!run || run.state !== 'active') return;
    const stage = stageOf(def, run.stage);
    if (!stage) return;

    const required = requiredObjectives(stage);
    const done = required.every(
      (o) => (run.progress[o.id] ?? 0) >= objectiveTarget(o),
    );
    if (!done) return;

    this.payRewards(def, stage);

    const branch = this.pickBranch(stage);
    if (!branch) return;

    for (const c of branch.consequences ?? []) this.applyConsequence(c);

    if (branch.to === null) {
      this.state.setRun({ ...this.state.run(def.id)!, state: 'completed' });
      this.events.push({
        kind: 'completed',
        questId: def.id,
        outcomeKey: branch.outcomeKey,
      });
      this.recordReel('chapter', branch.outcomeKey ?? def.titleKey);
      return;
    }

    this.enterStage(def, branch.to, { replay: false });
  }

  /** First branch whose condition holds. An absent condition always holds. */
  private pickBranch(stage: QuestStage) {
    return stage.branches.find((b) => this.test(b.requires)) ?? null;
  }

  private enterStage(def: QuestDef, stageId: string, opts: { replay: boolean }): void {
    const stage = stageOf(def, stageId);
    const run = this.state.run(def.id);
    if (!stage || !run) return;

    this.state.setRun({ ...run, stage: stageId, progress: {}, elapsed: 0, state: 'active' });

    if (!opts.replay) {
      for (const c of stage.onEnter ?? []) this.applyConsequence(c);
    }

    this.events.push({
      kind: 'stage',
      questId: def.id,
      stageId,
      sceneId: stage.sceneId,
      dialogueId: stage.dialogueId,
    });

    // A stage whose required objectives are already satisfied — a pure
    // cutscene beat, or one gated only on state the player already has —
    // must not sit there waiting for a report that will never come.
    this.settle(def);
  }

  private failStage(def: QuestDef, stage: QuestStage): void {
    const run = this.state.run(def.id);
    if (!run) return;
    const fail = stage.fail;

    this.events.push({ kind: 'failed', questId: def.id, messageKey: fail?.messageKey });

    if (!fail || fail.onFail === 'abandon') {
      this.state.setRun({ ...run, state: def.abandonable ? 'abandoned' : 'failed' });
      return;
    }

    const target =
      fail.onFail === 'checkpoint' ? checkpointBefore(def, stage.id) : stage.id;
    this.enterStage(def, target, { replay: true });
  }

  /** Explicit failure from the host — caught shoplifting, wrecked the van. */
  fail(questId: string): boolean {
    const run = this.state.run(questId);
    const def = this.lookup(questId);
    const stage = def && run ? stageOf(def, run.stage) : null;
    if (!def || !run || !stage || run.state !== 'active') return false;
    this.failStage(def, stage);
    return true;
  }

  /**
   * Put a quest down.
   *
   * Refused for a quest marked `abandonable: false`. The main-story chapters
   * are all marked so, because a player who abandons chapter 4 has a save
   * that can never reach an ending and no way to be told why.
   */
  abandon(questId: string): boolean {
    const def = this.lookup(questId);
    const run = this.state.run(questId);
    if (!def || !run || run.state !== 'active' || !def.abandonable) return false;
    this.state.setRun({ ...run, state: 'abandoned' });
    return true;
  }

  /** Start an abandoned or failed quest again, from its last checkpoint. */
  retry(questId: string): boolean {
    const def = this.lookup(questId);
    const run = this.state.run(questId);
    if (!def || !run) return false;
    if (run.state !== 'failed' && run.state !== 'abandoned') return false;

    this.state.setRun({ ...run, state: 'active' });
    this.enterStage(def, checkpointBefore(def, run.stage), { replay: true });
    return true;
  }

  // -- rewards -------------------------------------------------------------

  /**
   * Pay a stage's rewards, once ever.
   *
   * The key carries quest, stage and reward id, and `StoryState.claim` refuses
   * a key it has already seen. So a stage re-entered after a reload, or
   * settled twice in one frame by two reports landing together, pays exactly
   * once — and the key set is in the save, so a reload cannot re-pay it either.
   *
   * Optional objectives are what make this more than bookkeeping: their reward
   * is only claimed when they were actually done.
   */
  private payRewards(def: QuestDef, stage: QuestStage): void {
    const run = this.state.run(def.id);
    if (!run) return;

    for (const reward of stage.rewards ?? []) {
      const key = rewardKey(def.id, stage.id, reward.id);
      if (this.state.hasPaid(key)) continue;
      if (!this.state.claim(key)) continue;
      if (!this.host.grant(reward, key)) {
        // Could not be given in full — release the key so it can be paid
        // when there is room, rather than silently swallowing the reward.
        this.state.release(key);
        continue;
      }
      if (reward.money) {
        this.events.push({ kind: 'reward', questId: def.id, money: reward.money });
      }
    }

    for (const o of stage.objectives) {
      if (!o.optional) continue;
      if ((run.progress[o.id] ?? 0) < objectiveTarget(o)) continue;
      const key = rewardKey(def.id, stage.id, `optional:${o.id}`);
      if (!this.state.claim(key)) continue;
      this.recordReel('choice', o.labelKey);
    }
  }

  // -- conditions and consequences -----------------------------------------

  /** An absent condition is "always", not "never". See `StoryCondition`. */
  test(cond: StoryCondition | undefined): boolean {
    if (!cond) return true;

    for (const f of cond.flags ?? []) if (!this.state.has(f)) return false;
    for (const f of cond.notFlags ?? []) if (this.state.has(f)) return false;

    if (cond.minAge !== undefined && this.host.age < cond.minAge) return false;
    if (cond.maxAge !== undefined && this.host.age > cond.maxAge) return false;
    if (cond.minMoney !== undefined && this.host.money < cond.minMoney) return false;
    if (cond.mode !== undefined && this.host.mode !== cond.mode) return false;

    const rep = this.state.reputation;
    for (const [axis, min] of Object.entries(cond.minReputation ?? {})) {
      if (rep[axis as keyof typeof rep] < (min as number)) return false;
    }
    for (const [axis, max] of Object.entries(cond.maxReputation ?? {})) {
      if (rep[axis as keyof typeof rep] > (max as number)) return false;
    }

    if (cond.minRelationship) {
      const axes = this.host.relationship(cond.minRelationship.npcId);
      for (const [axis, min] of Object.entries(cond.minRelationship.axes)) {
        if (axes[axis as keyof RelationshipAxes] < (min as number)) return false;
      }
    }

    for (const q of cond.completedQuests ?? []) if (!this.state.isComplete(q)) return false;

    if (cond.choice && this.state.choice(cond.choice.id) !== cond.choice.is) return false;

    return true;
  }

  applyConsequence(c: Consequence): void {
    switch (c.kind) {
      case 'flag':
        this.state.setFlag(c.id);
        break;
      case 'clearFlag':
        this.state.clearFlag(c.id);
        break;
      case 'choice':
        if (this.state.choose(c.id, c.value)) this.recordReel('choice', `choice.${c.id}.${c.value}`);
        break;
      case 'reputation':
        this.state.adjustReputation(c.axis, c.delta);
        if (c.axis === 'law' && c.delta < 0) this.recordReel('law', 'reel.law.slipped');
        break;
      case 'relationship':
        this.host.adjustRelationship(c.npcId, c.axes);
        break;
      case 'unlockZone':
        this.host.unlockZone(c.zone);
        break;
      case 'completeChapter':
        this.host.completeChapter(c.id);
        break;
      case 'startQuest':
        this.start(c.id);
        break;
      case 'reel':
        this.recordReel(c.event, c.textKey);
        break;
    }
  }

  private recordReel(kind: ReelEvent['kind'], textKey: string, detail?: string): void {
    this.state.recordReel({
      kind,
      age: Math.round(this.host.age * 10) / 10,
      textKey,
      detail,
    });
  }

  // -- test mode -----------------------------------------------------------

  /**
   * Jump straight to a stage.
   *
   * Debug tooling, and the brief asks for it explicitly. `Game` exposes it
   * only through the `?e2e=1` bridge, so it is not reachable in ordinary play
   * — the same rule every other debug operation in this repository follows.
   *
   * `replay: true`, so jumping does not re-apply the stage's entry
   * consequences: a test that jumps to chapter 6 to check an ending must not
   * accumulate six chapters of reputation on the way past.
   */
  jumpToStage(questId: string, stageId: string): boolean {
    const def = this.lookup(questId);
    if (!def || !stageOf(def, stageId)) return false;

    if (!this.state.run(questId)) {
      this.state.setRun({
        id: questId,
        stage: stageId,
        progress: {},
        state: 'active',
        elapsed: 0,
      });
    } else {
      this.state.setRun({ ...this.state.run(questId)!, state: 'active' });
    }
    this.enterStage(def, stageId, { replay: true });
    return true;
  }

  /**
   * Repair runs whose stage this build no longer has.
   *
   * A save is intent, not results — the same rule the world follows when it
   * rebuilds from the manifest. A quest edited between builds leaves a save
   * naming a stage that is gone, and dropping the quest would lose the run;
   * so it falls back to the last checkpoint at or before where it was, which
   * is somewhere the player has already been.
   */
  repairAfterRestore(): string[] {
    const repaired: string[] = [];
    for (const run of this.state.allRuns) {
      if (run.state !== 'active') continue;
      const def = this.lookup(run.id);
      if (!def) continue;
      if (stageOf(def, run.stage)) continue;
      const target = checkpointBefore(def, run.stage);
      this.state.setRun({ ...run, stage: target, progress: {}, elapsed: 0 });
      repaired.push(run.id);
    }
    return repaired;
  }
}

/**
 * Does a report satisfy this objective?
 *
 * An explicit objective id always wins. Otherwise the kind must agree and one
 * discriminator must match, so "the player entered city_downtown" cannot
 * complete "deliver the parcel to city_downtown" — the second needs an item
 * and the first has none.
 */
function matches(
  o: QuestObjective,
  what: ProgressReport,
  progress: Record<string, number>,
): boolean {
  if ((progress[o.id] ?? 0) >= objectiveTarget(o)) return false;
  if (what.objectiveId !== undefined) return o.id === what.objectiveId;
  if (what.kind !== undefined && what.kind !== o.kind) return false;

  switch (o.kind) {
    case 'travel':
      return (
        (o.zone !== undefined && o.zone === what.zone) ||
        (o.place !== undefined && o.place === what.place)
      );
    case 'talk':
    case 'follow':
      return o.npcId !== undefined && o.npcId === what.npcId;
    case 'collect':
      return o.itemId !== undefined && o.itemId === what.itemId;
    case 'deliver':
      return (
        o.place !== undefined &&
        o.place === what.place &&
        o.itemId !== undefined &&
        o.itemId === what.itemId
      );
    case 'interact':
    case 'park':
    case 'photograph':
      return o.place !== undefined && o.place === what.place;
    case 'work_shift':
      return o.taskId !== undefined && o.taskId === what.taskId;
    case 'buy':
      return (
        (o.serviceOffer !== undefined && o.serviceOffer === what.serviceOffer) ||
        (o.itemId !== undefined && o.itemId === what.itemId)
      );
    case 'drive':
    case 'escape':
    case 'wait':
    case 'combat':
      // Progress-only kinds: the host reports metres or seconds against the
      // objective id, so a loose match would be ambiguous between two of them.
      return false;
  }
}
