import type { ZoneId } from '../world/zones/Manifest';
import type { RelationshipAxes } from '../npc/Relationships';
import type { GameMode } from '../core/Gates';

/**
 * The authored story, as data.
 *
 * A quest is a one-off with a place in the story and a stage the save
 * remembers forever. A *task* is a shift you can do again tomorrow, and it
 * lives in `src/tasks/` — the two deliberately do not share a system, for the
 * reason `TaskDefinition.ts` gives at the top of itself.
 *
 * Three rules shape everything below, and each of them is a bug that has
 * already been paid for elsewhere in this repository:
 *
 * 1. **No logic in the definitions.** A stage names a condition; it does not
 *    evaluate one. `QuestSystem` is the only thing that decides, so there is
 *    one place to look when a branch takes the wrong turn.
 * 2. **Every reward is keyed.** `Economy.award` is idempotent on a key, and
 *    Phase 7 proved that the key has to identify the *completion* rather than
 *    the job. A quest reward's key carries the quest, the stage and the reward
 *    id, so a stage entered twice across a reload still pays once.
 * 3. **Text is a key, never a string.** `labelKey` is looked up in
 *    `strings.ts`. The validator refuses a key with no entry, which is the
 *    only way missing localisation is ever found before a player finds it.
 */

/**
 * What an objective asks for.
 *
 * The brief lists fourteen and all fourteen are here, including the two that
 * belong to phases which have not happened yet. `photograph` needs photo mode
 * (Phase 11) and `combat` needs weapons (Phase 9); both are *declared* so the
 * authored content can reference them and the validator can check them, and
 * both are marked in `OBJECTIVES_AWAITING_SYSTEMS` so nothing claims they are
 * playable. No main-story stage may require either — `validateQuest` enforces
 * that, which is how "the story must never require violent crime" becomes a
 * test rather than a promise.
 */
export type QuestObjectiveKind =
  /** Reach a named place, or a zone. */
  | 'travel'
  /** Speak to a named resident. */
  | 'talk'
  /** Use a named interaction point N times. */
  | 'interact'
  /** Hold N of an item, however you came by it. */
  | 'collect'
  /** Hand N of an item over at a named place. */
  | 'deliver'
  /** Cover N metres in a vehicle. */
  | 'drive'
  /** Leave a vehicle inside a named bay. */
  | 'park'
  /** Complete a `TaskSystem` job. */
  | 'work_shift'
  /** Buy a named item or service. */
  | 'buy'
  /** Photo mode, at a place. Phase 11. */
  | 'photograph'
  /** Stay within reach of someone for N seconds. */
  | 'follow'
  /** Break N metres of contact, inside a time limit. */
  | 'escape'
  /** Stay put for N seconds. */
  | 'wait'
  /** Optional, adult-gated, never on a main-story path. Phase 9. */
  | 'combat';

/** Objective kinds whose supporting system does not exist yet. */
export const OBJECTIVES_AWAITING_SYSTEMS: readonly QuestObjectiveKind[] = ['photograph', 'combat'];

export interface QuestObjective {
  readonly id: string;
  readonly kind: QuestObjectiveKind;
  /** Localisation key, resolved against `strings.ts`. Never a sentence. */
  readonly labelKey: string;
  /** Target for the counted kinds. Defaults to 1. */
  readonly count?: number;
  /** A named place the host resolves to a position. Never coordinates here. */
  readonly place?: string;
  readonly zone?: ZoneId;
  readonly npcId?: string;
  readonly itemId?: string;
  readonly taskId?: string;
  readonly serviceOffer?: string;
  /** `wait`, `follow`, `escape`. */
  readonly seconds?: number;
  /** `drive`, `escape`, `follow`. */
  readonly metres?: number;
  /**
   * Which vehicle the distance has to be covered in.
   *
   * Absent means any — the chapter-5 courier objective does not care whether
   * you used the scooter or the van, and one that did would be a rule the
   * player has to be told about.
   */
  readonly vehicleKind?: string;
  /**
   * Optional objectives never block a stage.
   *
   * They exist to be *rewarded*, not required — the brief asks for optional
   * objectives, and an optional objective that gates progress is just a
   * required one with a misleading name.
   */
  readonly optional?: boolean;
}

// ---------------------------------------------------------------------------
// Conditions and consequences
// ---------------------------------------------------------------------------

/** The two reputation axes the endings read. */
export type ReputationAxis = 'community' | 'law';

export type Reputation = Record<ReputationAxis, number>;

export const REPUTATION_AXES: readonly ReputationAxis[] = ['community', 'law'];

/**
 * Where `law` starts, and which way it moves.
 *
 * 1 is a clean record. Crime takes it down; making things right brings some of
 * it back. It is *not* the police Heat system — that is Phase 9 and it is a
 * live pursuit state. This is the thing the ending reads, and it is history.
 */
export const NEUTRAL_REPUTATION: Readonly<Reputation> = Object.freeze({
  community: 0,
  law: 1,
});

/**
 * A predicate over story state, as data.
 *
 * Every field is a *minimum* or an exact match, and absent fields are
 * unconstrained, so the empty condition is "always true" rather than "never".
 * That default matters: a branch with no condition is the fallback, and an
 * empty object meaning "never" would strand the player on the stage.
 */
export interface StoryCondition {
  /** All of these flags must be set. */
  readonly flags?: readonly string[];
  /** None of these flags may be set. */
  readonly notFlags?: readonly string[];
  readonly minAge?: number;
  readonly maxAge?: number;
  readonly minMoney?: number;
  readonly minReputation?: Partial<Reputation>;
  readonly maxReputation?: Partial<Reputation>;
  readonly minRelationship?: {
    readonly npcId: string;
    readonly axes: Partial<RelationshipAxes>;
  };
  readonly completedQuests?: readonly string[];
  /** An authored choice recorded earlier, matched exactly. */
  readonly choice?: { readonly id: string; readonly is: string };
  readonly mode?: GameMode;
}

/** What happens when a branch is taken, or a stage is entered. */
export type Consequence =
  | { readonly kind: 'flag'; readonly id: string }
  | { readonly kind: 'clearFlag'; readonly id: string }
  | { readonly kind: 'choice'; readonly id: string; readonly value: string }
  | { readonly kind: 'reputation'; readonly axis: ReputationAxis; readonly delta: number }
  | {
      readonly kind: 'relationship';
      readonly npcId: string;
      readonly axes: Partial<RelationshipAxes>;
    }
  | { readonly kind: 'unlockZone'; readonly zone: ZoneId }
  | { readonly kind: 'completeChapter'; readonly id: string }
  | { readonly kind: 'startQuest'; readonly id: string }
  | { readonly kind: 'reel'; readonly event: ReelEventKind; readonly textKey: string };

/** The kinds of moment the Life Reel remembers. */
export type ReelEventKind =
  | 'birthday'
  | 'choice'
  | 'job'
  | 'vehicle'
  | 'relationship'
  | 'law'
  | 'keepsake'
  | 'property'
  | 'chapter'
  | 'ending';

export const REEL_EVENT_KINDS: readonly ReelEventKind[] = [
  'birthday',
  'choice',
  'job',
  'vehicle',
  'relationship',
  'law',
  'keepsake',
  'property',
  'chapter',
  'ending',
];

/**
 * A payout.
 *
 * `id` is unique within its stage and becomes part of the award key, which is
 * what makes a reward survive a reload without paying twice. The validator
 * refuses two rewards sharing an id in the same quest for exactly that reason:
 * duplicate ids collapse to one key, and the second reward silently never pays.
 */
export interface QuestReward {
  readonly id: string;
  readonly money?: number;
  readonly items?: readonly { readonly id: string; readonly count: number }[];
}

// ---------------------------------------------------------------------------
// Stages and quests
// ---------------------------------------------------------------------------

export interface QuestBranch {
  readonly id: string;
  /** Next stage, or null to finish the quest. */
  readonly to: string | null;
  readonly requires?: StoryCondition;
  readonly consequences?: readonly Consequence[];
  /** Named on the Life Reel when this branch ends the quest. */
  readonly outcomeKey?: string;
}

/** How a stage can go wrong, and what happens then. */
export interface QuestFail {
  /** Active seconds, or null when only an explicit failure can end it. */
  readonly timeLimit: number | null;
  /**
   * Where a failed attempt lands.
   *
   * `retry` puts the player back at the stage's own start, `checkpoint` at the
   * last stage marked as one, and `abandon` ends the quest. Nothing fails into
   * a dead end: `QuestSystem` refuses a definition whose failure has nowhere
   * to go, because a quest you cannot resume is a save you have to delete.
   */
  readonly onFail: 'retry' | 'checkpoint' | 'abandon';
  readonly messageKey?: string;
}

export interface QuestStage {
  readonly id: string;
  readonly titleKey: string;
  readonly objectives: readonly QuestObjective[];
  /**
   * Evaluated in authored order; the first whose condition holds is taken.
   *
   * The last branch should be unconditional — that is the fallback, and
   * `validateQuest` warns when there is not one, because a stage whose every
   * branch is gated is the quest equivalent of the all-gated dialogue node
   * `validateDialogue` already refuses.
   */
  readonly branches: readonly QuestBranch[];
  /** Saving here resumes here. */
  readonly checkpoint?: boolean;
  readonly rewards?: readonly QuestReward[];
  /** Applied once, when the stage is entered. */
  readonly onEnter?: readonly Consequence[];
  /** Cutscene id, played on entry. */
  readonly sceneId?: string;
  /** Dialogue tree id, offered on entry. */
  readonly dialogueId?: string;
  readonly fail?: QuestFail;
  /** Shown in the journal while this stage is current. */
  readonly hintKey?: string;
}

export type QuestKind = 'main' | 'side';

export interface QuestDef {
  readonly id: string;
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly kind: QuestKind;
  /** 1..7. Side quests belong to the chapter that opens them. */
  readonly chapter: number;
  /** Quest ids that must be complete first. */
  readonly requires?: readonly string[];
  readonly minAge?: number;
  readonly maxAge?: number;
  /** Absent means both modes. Main-story quests are Story Mode only. */
  readonly mode?: GameMode;
  readonly startStage: string;
  readonly stages: readonly QuestStage[];
  /** May the player put this down once started? Main-story chapters may not. */
  readonly abandonable: boolean;
  /**
   * Bumped when a quest's shape changes enough that a save mid-run is wrong.
   *
   * A save carrying a stage id this build no longer has is repaired to the
   * quest's last checkpoint rather than dropped — see `QuestSystem.restore`.
   */
  readonly contentVersion: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function objectiveTarget(o: QuestObjective): number {
  if (o.kind === 'wait' || o.kind === 'follow') return Math.max(1, o.seconds ?? 1);
  if (o.kind === 'drive' || o.kind === 'escape') return Math.max(1, o.metres ?? 1);
  return Math.max(1, o.count ?? 1);
}

/** The award key for one reward. Carries quest, stage and reward. */
export function rewardKey(questId: string, stageId: string, rewardId: string): string {
  return `quest:${questId}:${stageId}:${rewardId}`;
}

export function stageOf(def: QuestDef, stageId: string): QuestStage | null {
  return def.stages.find((s) => s.id === stageId) ?? null;
}

/** Required objectives only. Optional ones never block a stage. */
export function requiredObjectives(stage: QuestStage): readonly QuestObjective[] {
  return stage.objectives.filter((o) => !o.optional);
}

/**
 * The last checkpoint at or before a stage, in authored order.
 *
 * Used when a save names a stage this build has dropped, and when a failure
 * asks to fall back. The start stage is treated as a checkpoint whether or not
 * it says so, because there is always somewhere to land.
 */
export function checkpointBefore(def: QuestDef, stageId: string): string {
  let best = def.startStage;
  for (const s of def.stages) {
    if (s.checkpoint) best = s.id;
    if (s.id === stageId) return best;
  }
  return best;
}
