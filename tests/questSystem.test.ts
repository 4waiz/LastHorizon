import { beforeEach, describe, expect, it } from 'vitest';
import { QuestSystem, type StoryHost } from '../src/story/QuestSystem';
import { StoryState } from '../src/story/StoryState';
import { checkpointBefore, rewardKey, type QuestDef, type QuestReward } from '../src/story/QuestDefinition';
import type { RelationshipAxes } from '../src/npc/Relationships';
import type { ZoneId } from '../src/world/zones/Manifest';

/**
 * The runtime, against small hand-built graphs.
 *
 * Deliberately *not* against the shipped catalogue — that is
 * `storyCatalog.test.ts`'s job. A runtime test that reads the real story
 * breaks every time a line of dialogue moves, which trains everyone to ignore
 * it. These graphs are three stages long and exist to be broken on purpose.
 */

const NEUTRAL: RelationshipAxes = {
  familiarity: 0,
  trust: 0,
  affection: 0,
  fear: 0,
  respect: 0,
};

class FakeHost implements StoryHost {
  age = 16;
  money = 100;
  mode = 'story' as const;
  chapter = 1;
  readonly granted: Array<{ reward: QuestReward; key: string }> = [];
  readonly zones: ZoneId[] = [];
  readonly chapters: string[] = [];
  readonly axes = new Map<string, Partial<RelationshipAxes>>();
  /** Flip to make every grant fail, as a full bag would. */
  refuseGrants = false;

  relationship(): RelationshipAxes {
    return NEUTRAL;
  }
  adjustRelationship(npcId: string, axes: Partial<RelationshipAxes>): void {
    this.axes.set(npcId, axes);
  }
  unlockZone(zone: ZoneId): void {
    this.zones.push(zone);
  }
  completeChapter(id: string): void {
    this.chapters.push(id);
  }
  grant(reward: QuestReward, key: string): boolean {
    if (this.refuseGrants) return false;
    this.granted.push({ reward, key });
    return true;
  }
}

/** A -> B -> end, with a reward on B and a branch that reads a flag. */
const SIMPLE: QuestDef = {
  id: 'test_simple',
  titleKey: 'quest.test.title',
  summaryKey: 'quest.test.summary',
  kind: 'side',
  chapter: 1,
  startStage: 'a',
  abandonable: true,
  contentVersion: 1,
  stages: [
    {
      id: 'a',
      titleKey: 'stage.a',
      checkpoint: true,
      objectives: [
        { id: 'talk', kind: 'talk', labelKey: 'obj.talk', npcId: 'v_maryam' },
        { id: 'extra', kind: 'collect', labelKey: 'obj.extra', itemId: 'apple', optional: true },
      ],
      branches: [{ id: 'on', to: 'b' }],
    },
    {
      id: 'b',
      titleKey: 'stage.b',
      objectives: [
        { id: 'fetch', kind: 'collect', labelKey: 'obj.fetch', itemId: 'bread', count: 3 },
      ],
      rewards: [{ id: 'pay', money: 40 }],
      branches: [
        { id: 'rich', to: null, requires: { flags: ['was_rich'] }, outcomeKey: 'outcome.rich' },
        { id: 'plain', to: null, outcomeKey: 'outcome.plain' },
      ],
    },
  ],
};

function make(defs: readonly QuestDef[] = [SIMPLE]) {
  const state = new StoryState();
  const host = new FakeHost();
  const lookup = (id: string) => defs.find((d) => d.id === id) ?? null;
  const quests = new QuestSystem(state, lookup, host, () => defs);
  return { state, host, quests };
}

describe('starting a quest', () => {
  it('refuses an unknown quest', () => {
    const { quests } = make();
    expect(quests.start('nope')).toEqual({ ok: false, reason: 'unknown-quest' });
  });

  it('refuses to start the same quest twice', () => {
    const { quests } = make();
    expect(quests.start('test_simple').ok).toBe(true);
    expect(quests.start('test_simple')).toEqual({ ok: false, reason: 'already-running' });
  });

  it('honours age, mode and prerequisite gates', () => {
    const gated: QuestDef = { ...SIMPLE, id: 'gated', minAge: 18, requires: ['test_simple'] };
    const { quests, host } = make([SIMPLE, gated]);

    expect(quests.start('gated')).toEqual({ ok: false, reason: 'too-young' });
    host.age = 18;
    expect(quests.start('gated')).toEqual({ ok: false, reason: 'prerequisites' });
  });

  it('lands on the start stage with nothing done', () => {
    const { quests, state } = make();
    quests.start('test_simple');
    expect(state.run('test_simple')).toMatchObject({ stage: 'a', state: 'active', elapsed: 0 });
  });
});

describe('objectives', () => {
  it('matches a report to the objective it fits', () => {
    const { quests } = make();
    quests.start('test_simple');

    expect(quests.report('test_simple', { npcId: 'v_someone_else' })).toBe(false);
    expect(quests.report('test_simple', { npcId: 'v_maryam' })).toBe(true);
  });

  it('does not let a travel report satisfy a deliver objective', () => {
    // Both name a place; only one names an item. The discriminator is what
    // stops "you arrived" completing "you handed it over".
    const deliver: QuestDef = {
      ...SIMPLE,
      id: 'deliver_test',
      stages: [
        {
          id: 'a',
          titleKey: 'stage.a',
          objectives: [
            { id: 'drop', kind: 'deliver', labelKey: 'obj.drop', place: 'farm', itemId: 'parcel' },
          ],
          branches: [{ id: 'on', to: null }],
        },
      ],
    };
    const { quests } = make([deliver]);
    quests.start('deliver_test');

    expect(quests.report('deliver_test', { place: 'farm' })).toBe(false);
    expect(quests.report('deliver_test', { place: 'farm', itemId: 'parcel' })).toBe(true);
  });

  it('does not require optional objectives to move on', () => {
    const { quests, state } = make();
    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });

    expect(state.run('test_simple')!.stage).toBe('b');
  });

  it('lets collect progress fall as well as rise', () => {
    // An item sold mid-stage has to move the bar back down; this is exactly
    // the trap Phase 7 hit wiring `collect` at four separate sources.
    const { quests } = make();
    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });

    quests.setProgress('test_simple', 'fetch', 2);
    expect(quests.view('test_simple')!.objectives[0].done).toBe(2);

    quests.setProgress('test_simple', 'fetch', 1);
    expect(quests.view('test_simple')!.objectives[0].done).toBe(1);
  });

  it('fills a wait objective from the seconds advance() consumes', () => {
    const waiting: QuestDef = {
      ...SIMPLE,
      id: 'wait_test',
      stages: [
        {
          id: 'a',
          titleKey: 'stage.a',
          objectives: [{ id: 'hold', kind: 'wait', labelKey: 'obj.hold', seconds: 10 }],
          branches: [{ id: 'on', to: null }],
        },
      ],
    };
    const { quests, state } = make([waiting]);
    quests.start('wait_test');

    quests.advance(4);
    expect(state.run('wait_test')!.progress.hold).toBe(4);
    quests.advance(7);
    expect(state.run('wait_test')!.state).toBe('completed');
  });
});

describe('branches', () => {
  it('takes the first branch whose condition holds', () => {
    const { quests, state } = make();
    state.setFlag('was_rich');
    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });
    quests.setProgress('test_simple', 'fetch', 3);

    const completed = quests.drainEvents().find((e) => e.kind === 'completed');
    expect(completed).toMatchObject({ outcomeKey: 'outcome.rich' });
  });

  it('falls through to the unconditional branch', () => {
    const { quests } = make();
    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });
    quests.setProgress('test_simple', 'fetch', 3);

    const completed = quests.drainEvents().find((e) => e.kind === 'completed');
    expect(completed).toMatchObject({ outcomeKey: 'outcome.plain' });
  });

  it('treats an absent condition as always, not never', () => {
    const { quests } = make();
    expect(quests.test(undefined)).toBe(true);
    expect(quests.test({})).toBe(true);
  });
});

describe('rewards are idempotent', () => {
  it('pays a stage reward exactly once however many times it settles', () => {
    const { quests, host } = make();
    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });

    quests.setProgress('test_simple', 'fetch', 3);
    // Settle again by hand: two reports landing in one frame used to be the
    // way a reward paid twice.
    quests.setProgress('test_simple', 'fetch', 3);

    expect(host.granted).toHaveLength(1);
    expect(host.granted[0].key).toBe(rewardKey('test_simple', 'b', 'pay'));
  });

  it('cannot re-pay a key that is already in the save', () => {
    const { quests, host, state } = make();
    // Simulate a reload: the key set survives, the run does not.
    state.claim(rewardKey('test_simple', 'b', 'pay'));

    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });
    quests.setProgress('test_simple', 'fetch', 3);

    expect(host.granted).toHaveLength(0);
  });

  it('releases the key when the grant could not be given', () => {
    // A full bag must not consume the reward. Releasing means it can pay
    // later; keeping the key would swallow it forever.
    const { quests, host, state } = make();
    host.refuseGrants = true;

    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });
    quests.setProgress('test_simple', 'fetch', 3);

    expect(state.hasPaid(rewardKey('test_simple', 'b', 'pay'))).toBe(false);
  });
});

describe('failure, retry and abandon', () => {
  const failing: QuestDef = {
    ...SIMPLE,
    id: 'fail_test',
    abandonable: true,
    startStage: 'a',
    stages: [
      {
        id: 'a',
        titleKey: 'stage.a',
        checkpoint: true,
        objectives: [{ id: 'talk', kind: 'talk', labelKey: 'obj.talk', npcId: 'v_maryam' }],
        branches: [{ id: 'on', to: 'b' }],
      },
      {
        id: 'b',
        titleKey: 'stage.b',
        objectives: [{ id: 'run', kind: 'wait', labelKey: 'obj.run', seconds: 100 }],
        fail: { timeLimit: 20, onFail: 'checkpoint', messageKey: 'fail.msg' },
        branches: [{ id: 'on', to: null }],
      },
    ],
  };

  it('drops to the last checkpoint when a stage times out', () => {
    const { quests, state } = make([failing]);
    quests.start('fail_test');
    quests.report('fail_test', { npcId: 'v_maryam' });
    expect(state.run('fail_test')!.stage).toBe('b');

    quests.advance(21);
    expect(state.run('fail_test')!.stage).toBe('a');
    expect(state.run('fail_test')!.state).toBe('active');
  });

  it('refuses to abandon a quest that says it cannot be abandoned', () => {
    const locked: QuestDef = { ...SIMPLE, id: 'locked', abandonable: false };
    const { quests } = make([locked]);
    quests.start('locked');
    expect(quests.abandon('locked')).toBe(false);
  });

  it('retries an abandoned quest from its checkpoint', () => {
    const { quests, state } = make();
    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });
    quests.abandon('test_simple');
    expect(state.run('test_simple')!.state).toBe('abandoned');

    expect(quests.retry('test_simple')).toBe(true);
    expect(state.run('test_simple')!.stage).toBe(checkpointBefore(SIMPLE, 'b'));
  });
});

describe('consequences', () => {
  it('records a choice once, and the first answer wins', () => {
    const { quests, state } = make();
    quests.applyConsequence({ kind: 'choice', id: 'route', value: 'left' });
    quests.applyConsequence({ kind: 'choice', id: 'route', value: 'right' });
    expect(state.choice('route')).toBe('left');
  });

  it('clamps reputation to 0..1 on both axes', () => {
    const { quests, state } = make();
    quests.applyConsequence({ kind: 'reputation', axis: 'community', delta: 5 });
    quests.applyConsequence({ kind: 'reputation', axis: 'law', delta: -5 });
    expect(state.reputation).toEqual({ community: 1, law: 0 });
  });

  it('routes zone unlocks and chapter completion through the host', () => {
    const { quests, host } = make();
    quests.applyConsequence({ kind: 'unlockZone', zone: 'city_old_market' });
    quests.applyConsequence({ kind: 'completeChapter', id: 'village_departure' });
    expect(host.zones).toEqual(['city_old_market']);
    expect(host.chapters).toEqual(['village_departure']);
  });

  it('starts a follow-on quest', () => {
    const second: QuestDef = { ...SIMPLE, id: 'second' };
    const { quests, state } = make([SIMPLE, second]);
    quests.applyConsequence({ kind: 'startQuest', id: 'second' });
    expect(state.run('second')?.state).toBe('active');
  });
});

describe('save safety', () => {
  it('survives a round trip with objectives and rewards intact', () => {
    const { quests, state } = make();
    quests.start('test_simple');
    quests.report('test_simple', { npcId: 'v_maryam' });
    quests.setProgress('test_simple', 'fetch', 2);

    const saved = JSON.parse(JSON.stringify(state.toJSON())) as ReturnType<StoryState['toJSON']>;

    const restored = new StoryState();
    restored.restore(saved);
    expect(restored.run('test_simple')).toMatchObject({ stage: 'b', progress: { fetch: 2 } });
  });

  it('repairs a run whose stage this build no longer has', () => {
    const { quests, state } = make();
    quests.start('test_simple');
    state.setRun({ id: 'test_simple', stage: 'stage_that_was_deleted', progress: {}, state: 'active', elapsed: 0 });

    expect(quests.repairAfterRestore()).toEqual(['test_simple']);
    expect(state.run('test_simple')!.stage).toBe('a');
  });

  it('does not re-apply entry consequences when a stage is replayed', () => {
    // Jumping is `replay: true` on purpose: a test that skips to chapter 6
    // must not accumulate six chapters of reputation on the way past.
    const entering: QuestDef = {
      ...SIMPLE,
      id: 'enter_test',
      stages: [
        {
          id: 'a',
          titleKey: 'stage.a',
          onEnter: [{ kind: 'reputation', axis: 'community', delta: 0.5 }],
          objectives: [{ id: 'talk', kind: 'talk', labelKey: 'obj.talk', npcId: 'v_maryam' }],
          branches: [{ id: 'on', to: null }],
        },
      ],
    };
    const { quests, state } = make([entering]);
    quests.jumpToStage('enter_test', 'a');
    expect(state.reputation.community).toBe(0);
  });
});

describe('state container', () => {
  let state: StoryState;
  beforeEach(() => {
    state = new StoryState();
  });

  it('starts with a clean record and no standing', () => {
    expect(state.reputation).toEqual({ community: 0, law: 1 });
  });

  it('claims a reward key exactly once', () => {
    expect(state.claim('k')).toBe(true);
    expect(state.claim('k')).toBe(false);
    state.release('k');
    expect(state.claim('k')).toBe(true);
  });

  it('keeps birthdays when the reel overflows', () => {
    // The cap drops ordinary entries first: a run long enough to overflow is
    // one whose birthdays are the spine of the timeline.
    for (let i = 0; i < 300; i++) {
      state.recordReel({ kind: i % 50 === 0 ? 'birthday' : 'job', age: 15 + i / 30, textKey: `k${i}` });
    }
    const birthdays = state.reel.filter((e) => e.kind === 'birthday');
    expect(birthdays).toHaveLength(6);
  });

  it('restores an absent story block as a fresh run', () => {
    state.setFlag('x');
    state.restore(undefined);
    expect(state.has('x')).toBe(false);
    expect(state.reputation).toEqual({ community: 0, law: 1 });
  });
});
