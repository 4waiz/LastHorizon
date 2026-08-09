import { describe, expect, it } from 'vitest';
import { validateQuest, validateStory } from '../src/story/storyValidation';
import { CHAPTERS, MAIN_QUEST_IDS, QUESTS, SIDE_QUEST_IDS, questDef } from '../src/story/storyCatalog';
import { ENDINGS, ENDING_FAMILIES, endingsOf, familyFromFlags, resolveEnding } from '../src/story/Endings';
import { CUTSCENES, sceneLength, cutscene } from '../src/story/Cutscenes';
import { DIALOGUE_TREES } from '../src/story/dialogueCatalog';
import { STRINGS, hasString } from '../src/story/strings';
import { QuestSystem } from '../src/story/QuestSystem';
import { StoryState } from '../src/story/StoryState';
import type { QuestDef, StoryCondition } from '../src/story/QuestDefinition';
import type { RelationshipAxes } from '../src/npc/Relationships';

/**
 * The shipped story, checked as content.
 *
 * `validateStory()` is the gate; the rest of this file asserts the things a
 * generic validator cannot know — that there are enough missions, that the
 * brief's "never require violent crime" rule holds, and that each of the three
 * ending families is actually reachable.
 */

const NEUTRAL: RelationshipAxes = {
  familiarity: 0,
  trust: 0,
  affection: 0,
  fear: 0,
  respect: 0,
};

describe('the story validates', () => {
  it('has no issues at all', () => {
    const issues = validateStory();
    const report = issues.map((i) => `[${i.code}] ${i.where}: ${i.message}`).join('\n');
    expect(issues, `\n${report}`).toEqual([]);
  });

  it('validates each quest on its own too', () => {
    for (const q of QUESTS) {
      const issues = validateQuest(q);
      expect(issues, `${q.id}: ${issues.map((i) => i.message).join('; ')}`).toEqual([]);
    }
  });
});

describe('content targets from the brief', () => {
  it('ships at least 10 main missions and 18 side tasks', () => {
    expect(MAIN_QUEST_IDS.length).toBeGreaterThanOrEqual(10);
    expect(SIDE_QUEST_IDS.length).toBeGreaterThanOrEqual(18);
  });

  it('covers all seven chapters with main missions', () => {
    for (const c of CHAPTERS) {
      const mains = QUESTS.filter((q) => q.kind === 'main' && q.chapter === c.number);
      expect(mains.length, `chapter ${c.number} has no main quest`).toBeGreaterThan(0);
    }
  });

  it('uses at least ten of the fourteen objective kinds', () => {
    // The brief lists fourteen. Two await their systems (photograph, combat)
    // and are declared rather than authored, so ten in play is the honest bar.
    const kinds = new Set(QUESTS.flatMap((q) => q.stages.flatMap((s) => s.objectives.map((o) => o.kind))));
    expect(kinds.size).toBeGreaterThanOrEqual(10);
  });

  it('never requires violent crime on a main mission', () => {
    // The single most important rule in the phase brief, as an assertion.
    for (const q of QUESTS) {
      if (q.kind !== 'main') continue;
      for (const s of q.stages) {
        for (const o of s.objectives) {
          expect(o.kind, `${q.id}/${s.id}/${o.id}`).not.toBe('combat');
        }
      }
    }
  });

  it('offers a legal route through chapter 6', () => {
    // Five routes, four of them legal. If a future edit made crime the only
    // way out of the weigh stage, this fails.
    const offer = questDef('q6_the_offer')!;
    const weigh = offer.stages.find((s) => s.id === 'weigh')!;
    const legal = weigh.branches.filter((b) => b.to !== null && b.to !== 'crime');
    expect(legal.length).toBeGreaterThanOrEqual(4);
  });

  it('marks every main chapter unabandonable and every side task abandonable', () => {
    for (const q of QUESTS) {
      expect(q.abandonable, q.id).toBe(q.kind === 'side');
    }
  });

  it('gates the adult chapters on age', () => {
    expect(questDef('q4_departure')!.minAge).toBe(18);
    expect(questDef('q7_last_horizon')!.minAge).toBe(25);
  });

  it('keeps the main story out of Free Roam', () => {
    for (const q of QUESTS) {
      if (q.kind === 'main') expect(q.mode, q.id).toBe('story');
    }
  });
});

describe('the story is completable', () => {
  /**
   * Walk the main spine start to finish with a stub host, reporting whatever
   * each objective asks for.
   *
   * This is the unit-level form of acceptance criterion 1. The browser run
   * proves it in a real game; this proves the *graph* has no stage that cannot
   * be satisfied, in a millisecond, on every commit.
   */
  function walkMainStory(choices: Readonly<Record<string, string>>): string[] {
    const state = new StoryState();
    const reached: string[] = [];
    let age = 15;

    const quests = new QuestSystem(
      state,
      (id) => questDef(id),
      {
        get age() {
          return age;
        },
        money: 100_000,
        mode: 'story',
        chapter: 1,
        relationship: () => NEUTRAL,
        adjustRelationship: () => {},
        unlockZone: () => {},
        completeChapter: () => {},
        grant: () => true,
      },
      () => QUESTS,
    );

    // Pre-record the authored choices the dialogue would set.
    for (const [id, value] of Object.entries(choices)) state.choose(id, value);

    for (const def of QUESTS.filter((q) => q.kind === 'main')) {
      age = Math.max(age, def.minAge ?? age);
      if (!state.run(def.id)) quests.start(def.id);

      // Drive the current stage until the quest ends or nothing moves.
      for (let guard = 0; guard < 60; guard++) {
        const run = state.run(def.id);
        if (!run || run.state !== 'active') break;
        const stage = def.stages.find((s) => s.id === run.stage);
        if (!stage) break;
        reached.push(`${def.id}/${stage.id}`);

        for (const o of stage.objectives) {
          if (o.optional) continue;
          if (o.kind === 'wait') quests.advance((o.seconds ?? 1) + 1);
          else quests.setProgress(def.id, o.id, Number.MAX_SAFE_INTEGER);
        }
        if (state.run(def.id)?.stage === run.stage && state.run(def.id)?.state === 'active') break;
      }

      expect(state.isComplete(def.id), `${def.id} did not complete`).toBe(true);
    }
    return reached;
  }

  it('completes on a fully legal route', () => {
    const reached = walkMainStory({
      ch2_bicycle: 'fix',
      ch3_mentor: 'school',
      ch5_route: 'straight',
      ch5_someone: 'sana',
      ch6_route: 'law',
      ch7_home: 'return',
    });
    expect(reached).toContain('q6_the_offer/law');
    expect(reached).not.toContain('q6_the_offer/crime');
  });

  it('completes on a mixed route that uses the shortcut and the pegs', () => {
    const reached = walkMainStory({
      ch2_bicycle: 'buy',
      ch3_mentor: 'road',
      ch5_route: 'shortcut',
      ch5_someone: 'alone',
      ch6_route: 'crime',
      ch7_home: 'stay',
    });
    expect(reached).toContain('q5_a_name/shortcut');
    expect(reached).toContain('q6_the_offer/crime');
  });

  it('completes with no choices recorded at all', () => {
    // Every fork has an unconditional fallback, so a player who never answers
    // still reaches an ending rather than sticking.
    expect(() => walkMainStory({})).not.toThrow();
  });
});

describe('endings', () => {
  const test = (state: StoryState, money: number) => {
    const quests = new QuestSystem(state, () => null, {
      age: 25,
      money,
      mode: 'story',
      chapter: 7,
      relationship: () => NEUTRAL,
      adjustRelationship: () => {},
      unlockZone: () => {},
      completeChapter: () => {},
      grant: () => true,
    });
    return (c: StoryCondition | undefined) => quests.test(c);
  };

  it('has three families and thirteen variants', () => {
    expect(ENDING_FAMILIES).toHaveLength(3);
    expect(ENDINGS).toHaveLength(13);
  });

  it('always resolves to something, for every family', () => {
    const state = new StoryState();
    for (const family of ENDING_FAMILIES) {
      const e = resolveEnding(family, test(state, 0));
      expect(e.family).toBe(family);
      expect(hasString(e.titleKey)).toBe(true);
    }
  });

  it('reads the law record', () => {
    const clean = new StoryState();
    const marked = new StoryState();
    marked.adjustReputation('law', -0.7);

    expect(resolveEnding('stay_rise', test(clean, 20_000)).id).not.toBe('stay_rise_wanted');
    expect(resolveEnding('stay_rise', test(marked, 20_000)).id).toBe('stay_rise_wanted');
  });

  it('reads community standing and money', () => {
    const trusted = new StoryState();
    trusted.adjustReputation('community', 0.8);
    expect(resolveEnding('stay_rise', test(trusted, 5_000)).id).toBe('stay_rise_respected');

    const cold = new StoryState();
    expect(resolveEnding('stay_rise', test(cold, 20_000)).id).toBe('stay_rise_magnate');
  });

  it('picks the family from the chapter 7 flag, defaulting to living between', () => {
    expect(familyFromFlags((f) => f === 'ch7_return')).toBe('return_build');
    expect(familyFromFlags((f) => f === 'ch7_stay')).toBe('stay_rise');
    expect(familyFromFlags(() => false)).toBe('live_between');
  });

  it('ends each family with an unconditional variant', () => {
    for (const family of ENDING_FAMILIES) {
      const variants = endingsOf(family);
      expect(variants[variants.length - 1].requires, family).toBeUndefined();
    }
  });
});

describe('cutscenes', () => {
  it('ships nine scenes, all skippable and all under 30 seconds', () => {
    expect(CUTSCENES).toHaveLength(9);
    for (const s of CUTSCENES) {
      expect(s.skippable, s.id).toBe(true);
      expect(sceneLength(s), s.id).toBeLessThanOrEqual(30);
      expect(s.shots.length, s.id).toBeGreaterThan(0);
    }
  });

  it('only plays gestures the rig actually has', () => {
    // `player.glb` carries ten clips; these three are the upper-body overlays
    // Phase 4 added. Naming one the rig lacks fails silently at runtime.
    const available = new Set(['Wave', 'CarryBox', 'UsePhone']);
    for (const s of CUTSCENES) {
      for (const shot of s.shots) {
        if (shot.gesture) expect(available.has(shot.gesture), `${s.id}: ${shot.gesture}`).toBe(true);
      }
    }
  });

  it('resolves every scene named by a stage', () => {
    for (const q of QUESTS) {
      for (const s of q.stages) {
        if (s.sceneId) expect(cutscene(s.sceneId), `${q.id}/${s.id}`).not.toBeNull();
      }
    }
  });
});

describe('localisation', () => {
  it('has no unused keys drifting in the table', () => {
    // A key nothing references is a line somebody wrote and forgot to wire up,
    // or a rename that left the old entry behind. Both are worth knowing.
    const referenced = new Set<string>();
    const add = (k?: string) => {
      if (k) referenced.add(k);
    };

    for (const q of QUESTS) {
      add(q.titleKey);
      add(q.summaryKey);
      for (const s of q.stages) {
        add(s.titleKey);
        add(s.hintKey);
        add(s.fail?.messageKey);
        for (const o of s.objectives) add(o.labelKey);
        for (const b of s.branches) {
          add(b.outcomeKey);
          for (const c of b.consequences ?? []) collectConsequenceKeys(c, add);
        }
        for (const c of s.onEnter ?? []) collectConsequenceKeys(c, add);
      }
    }
    for (const c of CHAPTERS) add(c.titleKey);
    for (const e of ENDINGS) {
      add(e.titleKey);
      add(e.bodyKey);
    }
    for (const t of DIALOGUE_TREES) {
      for (const n of Object.values(t.nodes)) {
        add(n.text);
        for (const ch of n.choices) {
          add(ch.text);
          for (const c of ch.consequences ?? []) collectConsequenceKeys(c, add);
        }
      }
    }
    for (const s of CUTSCENES) for (const shot of s.shots) add(shot.captionKey);

    // `ui.*` and `reel.*` are referenced from code rather than data, so they
    // are exempt from the sweep rather than asserted against it.
    const unused = Object.keys(STRINGS).filter(
      (k) => !referenced.has(k) && !k.startsWith('ui.') && !k.startsWith('reel.'),
    );
    expect(unused).toEqual([]);
  });
});

function collectConsequenceKeys(
  c: { kind: string; id?: string; value?: string; textKey?: string },
  add: (k?: string) => void,
): void {
  if (c.kind === 'reel') add(c.textKey);
  if (c.kind === 'choice' && c.id && c.value) add(`choice.${c.id}.${c.value}`);
}

describe('quests reference systems that exist', () => {
  it('names only chapters the catalogue declares as closers', () => {
    const declared = new Set(CHAPTERS.map((c) => c.id));
    // `village_departure` is a milestone inside chapter 4, not a chapter, and
    // has gated the city since Phase 3. It is the one legitimate extra.
    declared.add('village_departure');

    for (const q of QUESTS) {
      for (const s of q.stages) {
        for (const c of [...(s.onEnter ?? []), ...s.branches.flatMap((b) => b.consequences ?? [])]) {
          if (c.kind === 'completeChapter') expect(declared.has(c.id), `${q.id}: ${c.id}`).toBe(true);
        }
      }
    }
  });

  it('closes each chapter with the quest the catalogue says closes it', () => {
    for (const c of CHAPTERS) {
      const closer = questDef(c.closesOn) as QuestDef;
      const completes = closer.stages.some((s) =>
        [...(s.onEnter ?? []), ...s.branches.flatMap((b) => b.consequences ?? [])].some(
          (con) => con.kind === 'completeChapter' && con.id === c.id,
        ),
      );
      // Chapter 7 ends the story rather than completing a chapter id.
      if (c.number !== 7) expect(completes, `${c.id} is never completed by ${c.closesOn}`).toBe(true);
    }
  });
});
