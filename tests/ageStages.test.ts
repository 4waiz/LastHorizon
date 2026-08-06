import { describe, it, expect } from 'vitest';
import {
  AGE_STAGES,
  appearanceForAge,
  crossesStage,
  lerpProportions,
  proportionsForAge,
  stageForAge,
} from '../src/player/AgeStages';
import { MAX_AGE, MIN_AGE } from '../src/core/clocks/LifeClock';

describe('the stage table covers the supported range', () => {
  it('spans 15 to 80 with no gaps', () => {
    for (let age = MIN_AGE; age <= MAX_AGE; age++) {
      expect(stageForAge(age), String(age)).toBeTruthy();
    }
  });

  it('has no overlapping bands', () => {
    for (let i = 1; i < AGE_STAGES.length; i++) {
      expect(AGE_STAGES[i].minAge).toBe(AGE_STAGES[i - 1].maxAge + 1);
    }
  });

  it('matches the stages the brief names', () => {
    expect(stageForAge(15).id).toBe('teen');
    expect(stageForAge(17).id).toBe('teen');
    expect(stageForAge(18).id).toBe('youngAdult');
    expect(stageForAge(24).id).toBe('youngAdult');
    expect(stageForAge(25).id).toBe('adult');
    expect(stageForAge(39).id).toBe('adult');
    expect(stageForAge(40).id).toBe('middleAged');
    expect(stageForAge(59).id).toBe('middleAged');
    expect(stageForAge(60).id).toBe('senior');
    expect(stageForAge(80).id).toBe('senior');
  });

  it('polishes the first two stages and only structurally supports the rest', () => {
    expect(AGE_STAGES.filter((s) => s.polished).map((s) => s.id)).toEqual([
      'teen',
      'youngAdult',
    ]);
  });

  it('clamps ages outside the range rather than returning nothing', () => {
    expect(stageForAge(3).id).toBe('teen');
    expect(stageForAge(200).id).toBe('senior');
    expect(stageForAge(Number.NaN).id).toBe('teen');
  });
});

describe('criterion 1 — 17 to 18 without skeleton breakage', () => {
  it('crosses a stage boundary at exactly that birthday', () => {
    expect(crossesStage(17, 18)).toBe(true);
    expect(crossesStage(18, 19)).toBe(false);
  });

  it('changes only proportions, never the mesh or rig', () => {
    // A stage carries proportions, hair and colour -- no mesh or skeleton
    // reference, so there is nothing to swap or rebind at a birthday.
    for (const s of AGE_STAGES) {
      expect(Object.keys(s).sort()).toEqual(
        ['hair', 'hairColour', 'id', 'label', 'maxAge', 'minAge', 'polished', 'proportions'].sort(),
      );
    }
  });

  it('is already most of the way there before the birthday, so it does not pop', () => {
    const teen = stageForAge(15).proportions;
    const adult = stageForAge(18).proportions;
    const justBefore = proportionsForAge(17.9);

    // Mid-teen sits at the teen build.
    expect(proportionsForAge(15).height).toBeCloseTo(teen.height, 6);
    // By the eve of the birthday it is nearly the adult build...
    expect(justBefore.height).toBeGreaterThan(teen.height);
    expect(Math.abs(justBefore.height - adult.height)).toBeLessThan(0.02);
    // ...so the step across the birthday itself is small.
    const step = Math.abs(proportionsForAge(18).height - justBefore.height);
    expect(step).toBeLessThan(0.02);
  });

  it('never moves a proportion by more than a few percent per year', () => {
    for (let age = MIN_AGE; age < MAX_AGE; age++) {
      const a = proportionsForAge(age);
      const b = proportionsForAge(age + 1);
      expect(Math.abs(b.height - a.height), `${age}->${age + 1}`).toBeLessThan(0.1);
      expect(Math.abs(b.shoulders - a.shoulders), `${age}->${age + 1}`).toBeLessThan(0.1);
    }
  });
});

describe('proportions stay in a sane band', () => {
  it('never strays far enough to read as a child', () => {
    for (let age = MIN_AGE; age <= MAX_AGE; age++) {
      const p = proportionsForAge(age);
      expect(p.height, String(age)).toBeGreaterThan(0.85);
      expect(p.height, String(age)).toBeLessThan(1.1);
      expect(p.head, String(age)).toBeLessThan(1.12);
    }
  });

  it('a teenager is shorter and narrower than an adult', () => {
    const teen = stageForAge(15).proportions;
    const adult = stageForAge(20).proportions;
    expect(teen.height).toBeLessThan(adult.height);
    expect(teen.shoulders).toBeLessThan(adult.shoulders);
    expect(teen.head).toBeGreaterThan(adult.head);
  });

  it('stoop only appears in the later stages', () => {
    expect(stageForAge(16).proportions.stoop).toBe(0);
    expect(stageForAge(20).proportions.stoop).toBe(0);
    expect(stageForAge(65).proportions.stoop).toBeGreaterThan(0);
  });

  it('the senior stage has no next stage to blend into', () => {
    expect(proportionsForAge(75)).toEqual(stageForAge(75).proportions);
  });
});

describe('lerpProportions', () => {
  it('clamps outside 0..1', () => {
    const a = stageForAge(15).proportions;
    const b = stageForAge(20).proportions;
    expect(lerpProportions(a, b, -1)).toEqual(a);
    expect(lerpProportions(a, b, 5)).toEqual(b);
  });

  it('is a true midpoint at 0.5', () => {
    const a = stageForAge(15).proportions;
    const b = stageForAge(20).proportions;
    expect(lerpProportions(a, b, 0.5).height).toBeCloseTo((a.height + b.height) / 2, 8);
  });
});

describe('appearanceForAge', () => {
  it('carries the hair variant and colour for the stage', () => {
    expect(appearanceForAge(16).hair).toBe('hair_shaggy');
    expect(appearanceForAge(20).hair).toBe('hair_short');
    // Grey arrives with the senior stage.
    expect(appearanceForAge(70).hairColour).not.toBe(appearanceForAge(20).hairColour);
  });

  it('reports the stage alongside the blended proportions', () => {
    const a = appearanceForAge(17.5);
    expect(a.stage.id).toBe('teen');
    // Blended toward the next stage, so not equal to the raw stage values.
    expect(a.proportions.height).toBeGreaterThan(a.stage.proportions.height);
  });
});
