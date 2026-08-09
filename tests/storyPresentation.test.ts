import { describe, expect, it, vi } from 'vitest';
import { DialogueRunner } from '../src/story/DialogueRunner';
import { dialogueTree } from '../src/story/dialogueCatalog';
import { CutscenePlayer, cutscene, type CutsceneHost, type Vec3Like } from '../src/story/Cutscenes';
import { buildReel, postcardFor, sanitiseName, REEL_HEIGHT, REEL_WIDTH } from '../src/story/LifeReel';
import { StoryState } from '../src/story/StoryState';
import { t } from '../src/story/strings';
import type { RelationshipAxes } from '../src/npc/Relationships';

const NEUTRAL: RelationshipAxes = {
  familiarity: 0,
  trust: 0,
  affection: 0,
  fear: 0,
  respect: 0,
};

const CLOSE: RelationshipAxes = {
  familiarity: 0.8,
  trust: 0.8,
  affection: 0.8,
  fear: 0,
  respect: 0.8,
};

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

describe('dialogue runner', () => {
  it('opens a tree at its root and resolves the text through the string table', () => {
    const runner = new DialogueRunner();
    const turn = runner.start(dialogueTree('dlg_eleni_keepsakes')!, 'v_eleni', {
      relationship: NEUTRAL,
      playerAge: 15,
    })!;

    expect(turn.nodeId).toBe('open');
    expect(turn.speaker).toBe('v_eleni');
    expect(turn.text).toBe(t('dlg.eleni_keepsakes.open'));
    expect(turn.text).not.toContain('dlg.');
  });

  it('keeps authored choice indices stable when one is filtered out', () => {
    // A gamepad reading "position 2" has to mean the same thing on every
    // device, so an unavailable choice must not renumber the ones after it.
    const runner = new DialogueRunner();
    const turn = runner.start(dialogueTree('dlg_maryam_job')!, 'v_maryam', {
      relationship: NEUTRAL,
      playerAge: 16,
    })!;

    const bold = turn.choices.find((c) => c.text === t('dlg.maryam_job.ask_bold'))!;
    expect(bold.index).toBe(1);
    expect(bold.available).toBe(false);
  });

  it('unlocks a gated choice when the relationship is there', () => {
    const runner = new DialogueRunner();
    const turn = runner.start(dialogueTree('dlg_maryam_job')!, 'v_maryam', {
      relationship: CLOSE,
      playerAge: 16,
    })!;
    expect(turn.choices[1].available).toBe(true);
  });

  it('explains a locked choice in the game’s voice, not the schema’s', () => {
    const runner = new DialogueRunner();
    const turn = runner.start(dialogueTree('dlg_maryam_job')!, 'v_maryam', {
      relationship: NEUTRAL,
      playerAge: 16,
    })!;
    const reason = turn.choices[1].lockedReason!;
    expect(reason).not.toMatch(/0\.\d/);
    expect(reason.length).toBeGreaterThan(0);
  });

  it('refuses a choice that is not available', () => {
    const runner = new DialogueRunner();
    runner.start(dialogueTree('dlg_maryam_job')!, 'v_maryam', {
      relationship: NEUTRAL,
      playerAge: 16,
    });
    expect(runner.choose(1)).toBeNull();
  });

  it('returns consequences rather than applying them', () => {
    const runner = new DialogueRunner();
    runner.start(dialogueTree('dlg_tomas_bicycle')!, 'v_tomas', {
      relationship: NEUTRAL,
      playerAge: 16,
    });
    runner.choose(0); // ask about fixing it
    const result = runner.choose(0)!; // commit to fixing it

    expect(result.outcome.consequences).toEqual([
      { kind: 'choice', id: 'ch2_bicycle', value: 'fix' },
    ]);
    expect(result.outcome.ended).toBe(true);
    expect(runner.active).toBe(false);
  });

  it('merges the choice’s effects with the node it arrives at', () => {
    const runner = new DialogueRunner();
    runner.start(dialogueTree('dlg_eleni_keepsakes')!, 'v_eleni', {
      relationship: NEUTRAL,
      playerAge: 15,
    });
    const result = runner.choose(0)!;
    // The choice carries nothing; the `what` node carries familiarity 0.05.
    expect(result.outcome.relationship).toMatchObject({ familiarity: 0.05 });
  });

  it('keeps a history of what was said', () => {
    const runner = new DialogueRunner();
    runner.start(dialogueTree('dlg_eleni_keepsakes')!, 'v_eleni', {
      relationship: NEUTRAL,
      playerAge: 15,
    });
    runner.choose(0);
    runner.choose(0);

    expect(runner.history.length).toBeGreaterThanOrEqual(3);
    expect(runner.history[0].text).toBe(t('dlg.eleni_keepsakes.open'));
    expect(runner.history[1].reply).toBe(t('dlg.eleni_keepsakes.what'));
  });

  it('can always be left, from any node', () => {
    const runner = new DialogueRunner();
    runner.start(dialogueTree('dlg_the_offer')!, 'v_bashir', {
      relationship: NEUTRAL,
      playerAge: 22,
    });
    runner.end();
    expect(runner.active).toBe(false);
    expect(runner.current()).toBeNull();
  });

  it('hides the crime route from anyone under 18', () => {
    const runner = new DialogueRunner();
    const young = runner.start(dialogueTree('dlg_the_offer')!, 'v_bashir', {
      relationship: NEUTRAL,
      playerAge: 17,
    })!;
    runner.choose(0);
    const routes = runner.current()!;
    const crime = routes.choices.find((c) => c.text === t('dlg.the_offer.crime'))!;
    expect(crime.available).toBe(false);
    expect(young.nodeId).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// Cutscenes
// ---------------------------------------------------------------------------

class FakeSceneHost implements CutsceneHost {
  readonly camera: Array<{ at: Vec3Like; look: Vec3Like }> = [];
  captions: Array<string | null> = [];
  gestures: string[] = [];
  controls = true;
  released = 0;
  places = new Map<string, Vec3Like>([['village_bench', { x: 10, y: 2, z: -5 }]]);

  place(name: string) {
    return this.places.get(name) ?? null;
  }
  playerPosition() {
    return { x: 0, y: 0, z: 0 };
  }
  npcPosition() {
    return null;
  }
  setCamera(at: Vec3Like, lookAt: Vec3Like) {
    this.camera.push({ at, look: lookAt });
  }
  releaseCamera() {
    this.released++;
  }
  setCaption(text: string | null) {
    this.captions.push(text);
  }
  playGesture(name: string) {
    this.gestures.push(name);
  }
  async fade() {}
  setControlsEnabled(on: boolean) {
    this.controls = on;
  }
}

describe('cutscene player', () => {
  it('does not play when the anchor is not in the loaded zone', async () => {
    // The honest failure. A camera flying to the origin reads as a crash.
    const host = new FakeSceneHost();
    host.places.clear();
    const player = new CutscenePlayer(host);

    await player.play(cutscene('cs_first_horizon')!);
    expect(player.playing).toBe(false);
    expect(host.camera).toHaveLength(0);
  });

  it('takes control, drives the camera and hands it back', async () => {
    const host = new FakeSceneHost();
    const player = new CutscenePlayer(host);
    const scene = cutscene('cs_first_horizon')!;

    const done = player.play(scene);
    await Promise.resolve();
    expect(host.controls).toBe(false);

    for (let i = 0; i < 200; i++) player.advance(0.1);
    await done;

    expect(player.playing).toBe(false);
    expect(host.controls).toBe(true);
    expect(host.released).toBe(1);
    expect(host.captions[host.captions.length - 1]).toBeNull();
  });

  it('places the camera relative to the anchor, not the world origin', async () => {
    const host = new FakeSceneHost();
    const player = new CutscenePlayer(host);
    void player.play(cutscene('cs_first_horizon')!);
    await Promise.resolve();

    const first = host.camera[0];
    // Anchor (10, 2, -5) plus the first shot's offset (0, 1.6, 3.2).
    expect(first.at.x).toBeCloseTo(10);
    expect(first.at.y).toBeCloseTo(3.6);
    expect(first.at.z).toBeCloseTo(-1.8);
  });

  it('can be skipped from anywhere', async () => {
    const host = new FakeSceneHost();
    const player = new CutscenePlayer(host);
    const done = player.play(cutscene('cs_first_horizon')!);
    await Promise.resolve();

    player.advance(1);
    player.skip();
    await done;

    expect(player.playing).toBe(false);
    expect(host.controls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Life Reel
// ---------------------------------------------------------------------------

const FACTS = {
  age: 25,
  money: 4230,
  shiftsWorked: 18,
  vehiclesOwned: 2,
  keepsakes: 5,
  keepsakeTotal: 5,
  property: ['apartment'],
  friends: [
    { name: 'Noor Haddad', closeness: 0.8 },
    { name: 'Tomás Ferreira', closeness: 0.5 },
  ],
  reputation: { community: 0.6, law: 1 },
};

describe('life reel', () => {
  it('reflects the choices that were actually made', () => {
    const state = new StoryState();
    state.recordReel({ kind: 'choice', age: 17, textKey: 'choice.ch3_mentor.trade' });
    state.recordReel({ kind: 'vehicle', age: 16, textKey: 'reel.q2.bicycle' });

    const model = buildReel(state, FACTS);
    const texts = model.timeline.map((r) => r.text);

    expect(texts).toContain(t('choice.ch3_mentor.trade'));
    expect(texts).toContain(t('reel.q2.bicycle'));
  });

  it('orders the timeline by age, keeping same-year events in the order they happened', () => {
    const state = new StoryState();
    state.recordReel({ kind: 'job', age: 16, textKey: 'reel.q2.firstjob' });
    state.recordReel({ kind: 'vehicle', age: 16, textKey: 'reel.q2.bicycle' });
    state.recordReel({ kind: 'keepsake', age: 15, textKey: 'reel.q1.allfive' });

    const model = buildReel(state, FACTS);
    expect(model.timeline.map((r) => r.text)).toEqual([
      t('reel.q1.allfive'),
      t('reel.q2.firstjob'),
      t('reel.q2.bicycle'),
    ]);
  });

  it('reads the ending onto the final card', () => {
    const state = new StoryState();
    state.setEnding('return_build_champion');
    const model = buildReel(state, FACTS);
    expect(model.finalTitle).toBe(t('ending.return_build_champion.title'));
    expect(model.finalBody).toBe(t('ending.return_build_champion.body'));
  });

  it('says something rather than nothing when the run has no ending yet', () => {
    const model = buildReel(new StoryState(), FACTS);
    expect(model.finalTitle).toBe(t('reel.subtitle'));
    expect(model.timeline).toEqual([]);
  });

  it('describes the law record in words, not numbers', () => {
    const clean = buildReel(new StoryState(), FACTS);
    const record = clean.sections.find((s) => s.title === t('reel.section.record'))!;
    expect(record.rows[0].value).toBe(t('reel.record.clean'));

    const marked = buildReel(new StoryState(), {
      ...FACTS,
      reputation: { community: 0.6, law: 0.2 },
    });
    const marked2 = marked.sections.find((s) => s.title === t('reel.section.record'))!;
    expect(marked2.rows[0].value).toBe(t('reel.record.bad'));
  });

  it('groups money without depending on the machine’s locale', () => {
    const model = buildReel(new StoryState(), { ...FACTS, money: 1234567 });
    const work = model.sections.find((s) => s.title === t('reel.section.work'))!;
    expect(work.rows[0].value).toBe('$1,234,567');
  });

  it('is deterministic: the same state produces the same model', () => {
    const state = new StoryState();
    state.recordReel({ kind: 'choice', age: 20, textKey: 'choice.ch5_route.straight' });
    expect(JSON.stringify(buildReel(state, FACTS))).toBe(JSON.stringify(buildReel(state, FACTS)));
  });

  it('ranks friends by closeness and shows at most five', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, closeness: i / 10 }));
    const model = buildReel(new StoryState(), { ...FACTS, friends: many });
    const people = model.sections.find((s) => s.title === t('reel.section.people'))!;
    expect(people.rows).toHaveLength(5);
    expect(people.rows[0].label).toBe('P8');
  });

  it('keeps anything personal off the card', () => {
    // Not an XSS guard — the canvas cannot execute. A privacy and layout guard.
    expect(sanitiseName('  Awaiz  Ahmed  ')).toBe('Awaiz Ahmed');
    expect(sanitiseName('a@b.com 07700 900000')).toBe('abcom');
    expect(sanitiseName('x'.repeat(80))).toHaveLength(20);
    expect(sanitiseName(undefined)).toBe('');
  });

  it('renders at a portrait size that survives a phone', () => {
    expect(REEL_WIDTH / REEL_HEIGHT).toBeCloseTo(0.8, 2);
  });

  it('makes a postcard for a birthday', () => {
    const card = postcardFor(18, ['The city', 'Adult work']);
    expect(card.age).toBe(18);
    expect(card.title).toBe('You turned 18');
    expect(card.body).toContain('The city');
  });

  it('exports a PNG locally, and nowhere else', async () => {
    // Guards the "no upload service in MVP" rule: the only sink is toBlob.
    const toBlob = vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/png' })));
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'measureText') return () => ({ width: 10 });
          if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
          if (prop === 'canvas') return { width: REEL_WIDTH, height: REEL_HEIGHT };
          return () => {};
        },
        set: () => true,
      },
    ) as CanvasRenderingContext2D;

    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob } as unknown as HTMLCanvasElement;
    const { exportReel } = await import('../src/story/LifeReel');
    const blob = await exportReel(buildReel(new StoryState(), FACTS), () => canvas);

    expect(blob).toBeInstanceOf(Blob);
    expect(toBlob).toHaveBeenCalledOnce();
  });
});
