import {
  OBJECTIVES_AWAITING_SYSTEMS,
  objectiveTarget,
  type QuestDef,
  type QuestObjective,
  type QuestStage,
} from './QuestDefinition';
import { CHAPTERS, QUESTS, questDef } from './storyCatalog';
import { ENDINGS, ENDING_FAMILIES, endingsOf } from './Endings';
import { hasString } from './strings';
import { DIALOGUE_TREES, dialogueTree } from './dialogueCatalog';
import { CUTSCENES, cutscene } from './Cutscenes';
import { validateDialogue } from '../npc/Dialogue';
import { NPC_CATALOGUE } from '../npc/npcCatalog';
import { TASKS } from '../tasks/taskCatalog';

/**
 * The story, checked.
 *
 * **This module is not in the runtime import graph.** It is imported by
 * `tests/` and by `scripts/check-story.mjs`, and by nothing the browser ever
 * loads — it pulls in the NPC catalogue and the task catalogue, both of which
 * are behind lazy chunks for good reasons, and dragging them back to the
 * startup path to run a check the build already ran would be exactly backwards.
 *
 * What it looks for is the list from the brief, and each one is a real way an
 * authored graph goes wrong:
 *
 * | Check | What it catches |
 * | --- | --- |
 * | impossible prerequisites | a quest gated behind one that can never precede it |
 * | cycles | A needs B needs A, and neither ever opens |
 * | missing localisation | a key with no string, which renders as the key |
 * | invalid objective targets | an npc, task or count that does not exist |
 * | unreachable branches | authored, paid for, never seen |
 * | duplicate rewards | two rewards sharing a key, so the second never pays |
 *
 * Plus the one that is a *design* rule rather than a data rule: **no main
 * quest may carry a combat objective.** The brief says the story must never
 * require violent crime, and this is what makes that a build failure instead
 * of a promise in a document.
 */

export interface StoryIssue {
  readonly where: string;
  readonly code: string;
  readonly message: string;
}

const NPC_IDS = new Set(NPC_CATALOGUE.map((n) => n.id));
const TASK_IDS = new Set(TASKS.map((t) => t.id));

export function validateStory(): StoryIssue[] {
  const issues: StoryIssue[] = [];

  const ids = new Set<string>();
  for (const q of QUESTS) {
    if (ids.has(q.id)) {
      issues.push({ where: q.id, code: 'duplicate-quest', message: `two quests share the id ${q.id}` });
    }
    ids.add(q.id);
    issues.push(...validateQuest(q));
  }

  issues.push(...validatePrerequisites());
  issues.push(...validateChapters());
  issues.push(...validateEndings());
  issues.push(...validateDialogueTrees());
  issues.push(...validateScenes());

  return issues;
}

// ---------------------------------------------------------------------------
// One quest
// ---------------------------------------------------------------------------

export function validateQuest(q: QuestDef): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const push = (code: string, message: string, where = q.id) =>
    issues.push({ where, code, message });

  for (const key of [q.titleKey, q.summaryKey]) {
    if (!hasString(key)) push('missing-string', `no string for ${key}`);
  }

  if (q.minAge !== undefined && q.maxAge !== undefined && q.minAge > q.maxAge) {
    push('impossible-age', `minAge ${q.minAge} is above maxAge ${q.maxAge}`);
  }

  const stageIds = new Set<string>();
  for (const s of q.stages) {
    if (stageIds.has(s.id)) push('duplicate-stage', `two stages share the id ${s.id}`);
    stageIds.add(s.id);
  }

  if (!stageIds.has(q.startStage)) {
    push('missing-start', `startStage ${q.startStage} is not one of the stages`);
    return issues;
  }

  // -- reachability, forwards ------------------------------------------------
  const reachable = new Set<string>();
  const stack = [q.startStage];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const stage = q.stages.find((s) => s.id === id);
    for (const b of stage?.branches ?? []) if (b.to) stack.push(b.to);
    // A failure that falls back to a stage keeps that stage reachable.
    if (stage?.fail?.onFail === 'retry') stack.push(id);
  }
  for (const s of q.stages) {
    if (!reachable.has(s.id)) {
      push('unreachable-stage', `stage ${s.id} cannot be reached from ${q.startStage}`, `${q.id}/${s.id}`);
    }
  }

  // -- can the quest ever end? ----------------------------------------------
  //
  // A stage graph that loops forever is the quest-shaped version of the
  // all-gated dialogue node `validateDialogue` already refuses. Walk backwards
  // from every terminal branch and check every reachable stage can get there.
  const terminates = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of q.stages) {
      if (terminates.has(s.id)) continue;
      const ok = s.branches.some((b) => b.to === null || terminates.has(b.to));
      if (ok) {
        terminates.add(s.id);
        grew = true;
      }
    }
  }
  for (const s of q.stages) {
    if (reachable.has(s.id) && !terminates.has(s.id)) {
      push('cycle', `stage ${s.id} can never reach an ending`, `${q.id}/${s.id}`);
    }
  }

  // -- per-stage -------------------------------------------------------------
  const rewardKeys = new Set<string>();
  for (const s of q.stages) {
    issues.push(...validateStage(q, s, stageIds, rewardKeys));
  }

  if (q.kind === 'main') {
    for (const s of q.stages) {
      for (const o of s.objectives) {
        if (o.kind === 'combat') {
          push(
            'combat-on-main',
            `main-story stage ${s.id} carries a combat objective; the story must never require it`,
            `${q.id}/${s.id}`,
          );
        }
      }
    }
  }

  return issues;
}

function validateStage(
  q: QuestDef,
  s: QuestStage,
  stageIds: ReadonlySet<string>,
  rewardKeys: Set<string>,
): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const where = `${q.id}/${s.id}`;
  const push = (code: string, message: string) => issues.push({ where, code, message });

  if (!hasString(s.titleKey)) push('missing-string', `no string for ${s.titleKey}`);
  if (s.hintKey && !hasString(s.hintKey)) push('missing-string', `no string for ${s.hintKey}`);
  if (s.fail?.messageKey && !hasString(s.fail.messageKey)) {
    push('missing-string', `no string for ${s.fail.messageKey}`);
  }

  if (s.objectives.length === 0 && s.branches.every((b) => b.requires)) {
    push('stuck-stage', 'no objectives and every branch is conditional');
  }

  const objIds = new Set<string>();
  for (const o of s.objectives) {
    if (objIds.has(o.id)) push('duplicate-objective', `two objectives share the id ${o.id}`);
    objIds.add(o.id);
    issues.push(...validateObjective(where, o));
  }

  if (s.objectives.length > 0 && s.objectives.every((o) => o.optional)) {
    push('all-optional', 'every objective is optional, so the stage completes instantly');
  }

  // -- branches --------------------------------------------------------------
  if (s.branches.length === 0) {
    push('dead-end', 'stage has no branches, so it can never be left');
  }

  const branchIds = new Set<string>();
  let sawUnconditional = false;
  for (const b of s.branches) {
    if (branchIds.has(b.id)) push('duplicate-branch', `two branches share the id ${b.id}`);
    branchIds.add(b.id);

    if (sawUnconditional) {
      push('unreachable-branch', `branch ${b.id} sits after an unconditional branch and can never be taken`);
    }
    if (!b.requires) sawUnconditional = true;

    if (b.to !== null && !stageIds.has(b.to)) {
      push('missing-target', `branch ${b.id} points at missing stage ${b.to}`);
    }
    if (b.outcomeKey && !hasString(b.outcomeKey)) {
      push('missing-string', `no string for ${b.outcomeKey}`);
    }
    for (const c of b.consequences ?? []) {
      issues.push(...validateConsequence(where, c));
    }
  }
  if (!sawUnconditional) {
    push('no-fallback', 'every branch is conditional; the stage can complete with nowhere to go');
  }

  for (const c of s.onEnter ?? []) issues.push(...validateConsequence(where, c));

  // -- rewards ---------------------------------------------------------------
  const seen = new Set<string>();
  for (const r of s.rewards ?? []) {
    if (seen.has(r.id)) {
      push('duplicate-reward', `two rewards share the id ${r.id}; the second would never pay`);
    }
    seen.add(r.id);

    const key = `${s.id}:${r.id}`;
    if (rewardKeys.has(key)) push('duplicate-reward', `reward key ${key} is used twice in this quest`);
    rewardKeys.add(key);

    if (r.money !== undefined && (!Number.isSafeInteger(r.money) || r.money < 0)) {
      push('bad-reward', `reward ${r.id} pays ${r.money}, which is not whole dollars`);
    }
    for (const item of r.items ?? []) {
      if (item.count <= 0) push('bad-reward', `reward ${r.id} grants ${item.count} of ${item.id}`);
    }
  }

  if (s.sceneId && !cutscene(s.sceneId)) {
    push('missing-scene', `stage names cutscene ${s.sceneId}, which does not exist`);
  }
  if (s.dialogueId && !dialogueTree(s.dialogueId)) {
    push('missing-dialogue', `stage names dialogue ${s.dialogueId}, which does not exist`);
  }

  return issues;
}

/**
 * Does an objective name everything its kind needs?
 *
 * This is the check that catches a `deliver` with no item — which would sit
 * there forever, because `matches()` requires both a place and an item and an
 * objective missing one can never be satisfied by any report.
 */
function validateObjective(where: string, o: QuestObjective): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const push = (code: string, message: string) =>
    issues.push({ where: `${where}/${o.id}`, code, message });

  if (!hasString(o.labelKey)) push('missing-string', `no string for ${o.labelKey}`);
  if (objectiveTarget(o) <= 0) push('bad-target', 'target is not positive');

  const need = (field: keyof QuestObjective, label: string) => {
    if (o[field] === undefined) push('missing-target', `a ${o.kind} objective needs ${label}`);
  };

  switch (o.kind) {
    case 'travel':
      if (o.place === undefined && o.zone === undefined) {
        push('missing-target', 'a travel objective needs a place or a zone');
      }
      break;
    case 'talk':
    case 'follow':
      need('npcId', 'an npcId');
      break;
    case 'collect':
      need('itemId', 'an itemId');
      break;
    case 'deliver':
      need('place', 'a place');
      need('itemId', 'an itemId');
      break;
    case 'interact':
    case 'park':
    case 'photograph':
      need('place', 'a place');
      break;
    case 'work_shift':
      need('taskId', 'a taskId');
      break;
    case 'buy':
      if (o.serviceOffer === undefined && o.itemId === undefined) {
        push('missing-target', 'a buy objective needs a serviceOffer or an itemId');
      }
      break;
    case 'drive':
      need('metres', 'a distance');
      break;
    case 'escape':
      need('metres', 'a distance');
      break;
    case 'wait':
      need('seconds', 'a duration');
      break;
    case 'combat':
      break;
  }

  if (o.npcId !== undefined && !NPC_IDS.has(o.npcId)) {
    push('unknown-npc', `${o.npcId} is not in the NPC catalogue`);
  }
  if (o.taskId !== undefined && !TASK_IDS.has(o.taskId)) {
    push('unknown-task', `${o.taskId} is not in the task catalogue`);
  }
  if (OBJECTIVES_AWAITING_SYSTEMS.includes(o.kind)) {
    push('awaiting-system', `${o.kind} has no supporting system yet; it cannot complete in play`);
  }

  return issues;
}

function validateConsequence(
  where: string,
  c: { kind: string; id?: string; value?: string; npcId?: string; textKey?: string },
): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const push = (code: string, message: string) => issues.push({ where, code, message });

  if (c.kind === 'startQuest' && c.id !== undefined && !questDef(c.id)) {
    push('unknown-quest', `startQuest names ${c.id}, which does not exist`);
  }
  if (c.kind === 'relationship' && c.npcId !== undefined && !NPC_IDS.has(c.npcId)) {
    push('unknown-npc', `${c.npcId} is not in the NPC catalogue`);
  }
  if (c.kind === 'reel' && c.textKey !== undefined && !hasString(c.textKey)) {
    push('missing-string', `no string for ${c.textKey}`);
  }
  // A recorded choice writes a reel line keyed on its value, so the string has
  // to exist for the value the consequence actually sets.
  if (c.kind === 'choice' && c.id !== undefined && c.value !== undefined) {
    const key = `choice.${c.id}.${c.value}`;
    if (!hasString(key)) push('missing-string', `no string for ${key}`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Across quests
// ---------------------------------------------------------------------------

/**
 * Prerequisites: cycles, missing quests, and gates that cannot both hold.
 *
 * The age check is the interesting one. A quest requiring another whose
 * `minAge` is *higher* than its own `maxAge` can never open, and that is not
 * obvious reading either definition on its own — it needs both.
 */
function validatePrerequisites(): StoryIssue[] {
  const issues: StoryIssue[] = [];

  for (const q of QUESTS) {
    for (const need of q.requires ?? []) {
      const dep = questDef(need);
      if (!dep) {
        issues.push({
          where: q.id,
          code: 'missing-prerequisite',
          message: `requires ${need}, which does not exist`,
        });
        continue;
      }
      if (dep.minAge !== undefined && q.maxAge !== undefined && dep.minAge > q.maxAge) {
        issues.push({
          where: q.id,
          code: 'impossible-prerequisite',
          message: `requires ${need}, which needs age ${dep.minAge}, but this closes at ${q.maxAge}`,
        });
      }
      if (dep.chapter > q.chapter) {
        issues.push({
          where: q.id,
          code: 'impossible-prerequisite',
          message: `chapter ${q.chapter} requires ${need} from chapter ${dep.chapter}`,
        });
      }
      if (dep.mode !== undefined && q.mode !== undefined && dep.mode !== q.mode) {
        issues.push({
          where: q.id,
          code: 'impossible-prerequisite',
          message: `requires ${need}, which is ${dep.mode}-only, but this is ${q.mode}-only`,
        });
      }
    }
  }

  // Cycles, by depth-first search with a colour marking.
  const state = new Map<string, 'open' | 'closed'>();
  const walk = (id: string, trail: string[]): void => {
    const mark = state.get(id);
    if (mark === 'closed') return;
    if (mark === 'open') {
      issues.push({
        where: id,
        code: 'cycle',
        message: `prerequisite cycle: ${[...trail, id].join(' -> ')}`,
      });
      return;
    }
    state.set(id, 'open');
    for (const need of questDef(id)?.requires ?? []) walk(need, [...trail, id]);
    state.set(id, 'closed');
  };
  for (const q of QUESTS) walk(q.id, []);

  return issues;
}

/** Each chapter's closing quest must exist and belong to that chapter. */
function validateChapters(): StoryIssue[] {
  const issues: StoryIssue[] = [];
  for (const c of CHAPTERS) {
    if (!hasString(c.titleKey)) {
      issues.push({ where: c.id, code: 'missing-string', message: `no string for ${c.titleKey}` });
    }
    const closer = questDef(c.closesOn);
    if (!closer) {
      issues.push({
        where: c.id,
        code: 'missing-quest',
        message: `closesOn names ${c.closesOn}, which does not exist`,
      });
      continue;
    }
    if (closer.chapter !== c.number) {
      issues.push({
        where: c.id,
        code: 'wrong-chapter',
        message: `closesOn ${c.closesOn} belongs to chapter ${closer.chapter}`,
      });
    }
  }
  return issues;
}

/**
 * Every family needs an unconditional last variant.
 *
 * Without one a run that matches nothing gets no card at all, and the failure
 * appears at the very end of a ten-hour story — the worst possible place to
 * find a content bug.
 */
function validateEndings(): StoryIssue[] {
  const issues: StoryIssue[] = [];
  const ids = new Set<string>();

  for (const e of ENDINGS) {
    if (ids.has(e.id)) {
      issues.push({ where: e.id, code: 'duplicate-ending', message: 'two endings share an id' });
    }
    ids.add(e.id);
    for (const key of [e.titleKey, e.bodyKey]) {
      if (!hasString(key)) {
        issues.push({ where: e.id, code: 'missing-string', message: `no string for ${key}` });
      }
    }
  }

  for (const family of ENDING_FAMILIES) {
    const variants = endingsOf(family);
    if (variants.length === 0) {
      issues.push({ where: family, code: 'empty-family', message: 'family has no endings' });
      continue;
    }
    const last = variants[variants.length - 1];
    if (last.requires) {
      issues.push({
        where: family,
        code: 'no-fallback',
        message: `the last variant (${last.id}) is conditional, so a run can match nothing`,
      });
    }
    for (let i = 0; i < variants.length - 1; i++) {
      if (!variants[i].requires) {
        issues.push({
          where: family,
          code: 'unreachable-ending',
          message: `${variants[i].id} is unconditional but not last; everything after it is dead`,
        });
      }
    }
  }

  return issues;
}

/**
 * The dialogue trees, through the validator Phase 6 already wrote, plus the
 * localisation check that only applies to *these* trees.
 *
 * `SMALL_TALK` holds sentences in `text` and story trees hold keys, and both
 * are correct — `t()` falls back to its argument. So the "every key has a
 * string" rule can only be applied to the story catalogue, which is what this
 * walks. Checking `SMALL_TALK` the same way would report every line it has.
 */
function validateDialogueTrees(): StoryIssue[] {
  const issues: StoryIssue[] = [];
  for (const tree of DIALOGUE_TREES) {
    for (const d of validateDialogue(tree)) {
      issues.push({ where: `dialogue/${d.tree}`, code: d.code, message: d.message });
    }

    for (const node of Object.values(tree.nodes)) {
      const where = `dialogue/${tree.id}/${node.id}`;
      if (!hasString(node.text)) {
        issues.push({ where, code: 'missing-string', message: `no string for ${node.text}` });
      }
      if (node.speaker && node.speaker !== 'narrator' && node.speaker !== 'player') {
        if (!NPC_IDS.has(node.speaker)) {
          issues.push({
            where,
            code: 'unknown-npc',
            message: `speaker ${node.speaker} is not in the NPC catalogue`,
          });
        }
      }
      for (const c of node.choices) {
        if (!hasString(c.text)) {
          issues.push({ where, code: 'missing-string', message: `no string for ${c.text}` });
        }
        for (const con of c.consequences ?? []) {
          issues.push(...validateConsequence(where, con));
        }
      }
    }
  }
  return issues;
}

/** Cutscenes: a shot list that ends, and a length somebody would sit through. */
function validateScenes(): StoryIssue[] {
  const issues: StoryIssue[] = [];
  for (const scene of CUTSCENES) {
    if (scene.shots.length === 0) {
      issues.push({ where: `scene/${scene.id}`, code: 'empty-scene', message: 'no shots' });
    }
    const total = scene.shots.reduce((sum, s) => sum + s.seconds, 0);
    if (total > 30) {
      issues.push({
        where: `scene/${scene.id}`,
        code: 'long-scene',
        message: `${total.toFixed(1)} s is longer than the 30 s ceiling`,
      });
    }
    for (const shot of scene.shots) {
      if (shot.seconds <= 0) {
        issues.push({ where: `scene/${scene.id}`, code: 'bad-shot', message: 'a shot has no duration' });
      }
      if (shot.captionKey && !hasString(shot.captionKey)) {
        issues.push({
          where: `scene/${scene.id}`,
          code: 'missing-string',
          message: `no string for ${shot.captionKey}`,
        });
      }
    }
  }
  return issues;
}
