import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AgeAppearance } from '../src/player/AgeAppearance';
import { AGE_STAGES, proportionsForAge, stageForAge } from '../src/player/AgeStages';
import { RIG_BONES, sceneBoneName, validateAgainstRig } from '../src/player/Sockets';

/**
 * A stand-in for the authored rig: one object per bone, parented the way
 * `build_character.py` builds it, with non-zero shoulder offsets so a width
 * change is measurable.
 */
function rig(): THREE.Object3D {
  const nodes = new Map<string, THREE.Object3D>();
  for (const name of RIG_BONES) {
    const o = new THREE.Object3D();
    o.name = name;
    nodes.set(name, o);
  }
  const parent: Record<string, string> = {
    hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
    'shoulder.L': 'chest', 'upperarm.L': 'shoulder.L', 'lowerarm.L': 'upperarm.L',
    'hand.L': 'lowerarm.L',
    'shoulder.R': 'chest', 'upperarm.R': 'shoulder.R', 'lowerarm.R': 'upperarm.R',
    'hand.R': 'lowerarm.R',
    'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L',
    'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R',
  };
  for (const [child, p] of Object.entries(parent)) {
    nodes.get(p)!.add(nodes.get(child)!);
  }
  nodes.get('shoulder.L')!.position.set(-0.16, 1.42, 0);
  nodes.get('shoulder.R')!.position.set(0.16, 1.42, 0);
  return nodes.get('root')!;
}

const find = (root: THREE.Object3D, name: string): THREE.Object3D =>
  root.getObjectByName(name)!;

describe('finding the rig', () => {
  /** The rig as the loaded scene actually holds it: dots stripped. */
  function loadedRig(): THREE.Object3D {
    const r = rig();
    r.traverse((o) => {
      o.name = sceneBoneName(o.name);
    });
    return r;
  }

  it('finds every bone in the form GLTFLoader produces', () => {
    // This is the shape that matters. Matching on authored names alone found
    // 6 of 20 in the real game -- exactly the six with no dot in them.
    const a = new AgeAppearance(loadedRig());
    expect(a.boneCount).toBe(RIG_BONES.length);
    expect(a.has('hand.R')).toBe(true);
    expect(a.has('shoulder.L')).toBe(true);
  });

  it('applies proportions to a loaded rig, not just an authored one', () => {
    const r = loadedRig();
    const a = new AgeAppearance(r);
    a.apply({ height: 1, shoulders: 1, head: 1, limb: 0.8, stoop: 0 });
    expect(r.getObjectByName(sceneBoneName('thigh.L'))!.scale.y).toBeCloseTo(0.8, 6);
  });

  it('picks up every authored bone', () => {
    const a = new AgeAppearance(rig());
    expect(a.boneCount).toBe(RIG_BONES.length);
    expect(a.has('hand.R')).toBe(true);
  });

  it('degrades to nothing rather than throwing on the capsule fallback', () => {
    const a = new AgeAppearance(null);
    expect(a.boneCount).toBe(0);
    a.applyAge(40);
    a.update();
    expect(a.has('root')).toBe(false);
  });
});

describe('proportions on the rig', () => {
  it('puts overall height on root, the one bone no clip keys', () => {
    // rotation is keyed on every bone except root; translation on hips;
    // scale on nothing. root is therefore the only safe home for height.
    const r = rig();
    const a = new AgeAppearance(r);
    a.apply(proportionsForAge(16));
    expect(find(r, 'root').scale.x).toBeCloseTo(stageForAge(16).proportions.height, 5);
  });

  it('makes a teenager shorter than an adult', () => {
    const teen = rig();
    const adult = rig();
    new AgeAppearance(teen).apply(proportionsForAge(15));
    new AgeAppearance(adult).apply(proportionsForAge(30));
    expect(find(teen, 'root').scale.y).toBeLessThan(find(adult, 'root').scale.y);
  });

  it('gives a teenager a proportionally larger head', () => {
    const teen = rig();
    const adult = rig();
    new AgeAppearance(teen).apply(proportionsForAge(15));
    new AgeAppearance(adult).apply(proportionsForAge(30));
    expect(find(teen, 'head').scale.x).toBeGreaterThan(find(adult, 'head').scale.x);
  });

  it('widens shoulders by moving them, not scaling them', () => {
    // Scaling the shoulder would drag the arm chain out with it and lengthen
    // the whole arm, so width has to be a position offset.
    const r = rig();
    const a = new AgeAppearance(r);
    a.apply({ height: 1, shoulders: 0.9, head: 1, limb: 1, stoop: 0 });

    const l = find(r, 'shoulder.L');
    expect(l.position.x).toBeCloseTo(-0.16 * 0.9, 6);
    expect(l.scale.x).toBe(1);
    // Height is untouched by a width change.
    expect(l.position.y).toBeCloseTo(1.42, 6);
  });

  it('scales limbs from the chain root so the joints below follow', () => {
    const r = rig();
    new AgeAppearance(r).apply({ height: 1, shoulders: 1, head: 1, limb: 0.9, stoop: 0 });
    expect(find(r, 'upperarm.L').scale.x).toBeCloseTo(0.9, 6);
    expect(find(r, 'thigh.R').scale.x).toBeCloseTo(0.9, 6);
    // The joints below inherit it; setting them too would compound.
    expect(find(r, 'lowerarm.L').scale.x).toBe(1);
    expect(find(r, 'hand.L').scale.x).toBe(1);
  });

  it('does not compound when applied repeatedly', () => {
    const r = rig();
    const a = new AgeAppearance(r);
    for (let i = 0; i < 5; i++) a.apply({ height: 1, shoulders: 0.5, head: 1, limb: 1, stoop: 0 });
    expect(find(r, 'shoulder.R').position.x).toBeCloseTo(0.16 * 0.5, 6);
  });

  it('returns the rig to rest', () => {
    const r = rig();
    const a = new AgeAppearance(r);
    a.apply(proportionsForAge(70));
    a.reset();
    expect(find(r, 'root').scale.x).toBe(1);
    expect(find(r, 'shoulder.L').position.x).toBeCloseTo(-0.16, 6);
  });
});

describe('stoop', () => {
  it('is applied in update, because the mixer owns bone rotation', () => {
    const r = rig();
    const a = new AgeAppearance(r);
    a.apply({ height: 1, shoulders: 1, head: 1, limb: 1, stoop: 0.2 });

    // apply() alone must not have rotated anything: the mixer would overwrite
    // it on the next frame, so writing it there would silently do nothing.
    expect(find(r, 'spine').rotation.x).toBe(0);

    a.update();
    expect(find(r, 'spine').rotation.x).toBeCloseTo(0.2, 6);
  });

  it('accumulates over a pose rather than replacing it, once per frame', () => {
    const r = rig();
    const a = new AgeAppearance(r);
    a.apply({ height: 1, shoulders: 1, head: 1, limb: 1, stoop: 0.1 });

    // Standing in for the mixer writing a pose each frame.
    for (let i = 0; i < 3; i++) {
      find(r, 'spine').rotation.set(0.05, 0, 0);
      a.update();
      expect(find(r, 'spine').rotation.x).toBeCloseTo(0.15, 6);
    }
  });

  it('is a no-op for a stage with no stoop', () => {
    const r = rig();
    const a = new AgeAppearance(r);
    a.apply(proportionsForAge(20));
    find(r, 'spine').rotation.set(0.05, 0, 0);
    a.update();
    expect(find(r, 'spine').rotation.x).toBeCloseTo(0.05, 6);
  });

  it('rises with the later stages', () => {
    const young = AGE_STAGES.find((s) => s.id === 'youngAdult')!;
    const senior = AGE_STAGES.find((s) => s.id === 'senior')!;
    expect(senior.proportions.stoop).toBeGreaterThan(young.proportions.stoop);
  });
});

describe('applyAge', () => {
  it('skips work when the age has not meaningfully moved', () => {
    const r = rig();
    const a = new AgeAppearance(r);
    a.applyAge(30);

    // A hand-edit that a re-apply would undo. A change below the epsilon must
    // leave it alone; this is what keeps it off the per-frame path.
    find(r, 'root').scale.set(9, 9, 9);
    a.applyAge(30.0001);
    expect(find(r, 'root').scale.x).toBe(9);

    a.applyAge(31);
    expect(find(r, 'root').scale.x).not.toBe(9);
  });

  it('blends across a birthday instead of popping', () => {
    const before = rig();
    const after = rig();
    // 17.9 is nearly adult; 18.0 is adult. The gap must be small.
    new AgeAppearance(before).applyAge(17.9);
    new AgeAppearance(after).applyAge(18);
    const gap = Math.abs(find(before, 'root').scale.y - find(after, 'root').scale.y);
    expect(gap).toBeLessThan(0.01);
  });

  it('ignores a non-finite age rather than collapsing the rig', () => {
    const r = rig();
    const a = new AgeAppearance(r);
    a.applyAge(Number.NaN);
    expect(find(r, 'root').scale.x).toBe(1);
  });
});

describe('bone name sanitisation', () => {
  it('matches what GLTFLoader does to a name', () => {
    expect(sceneBoneName('shoulder.L')).toBe('shoulderL');
    expect(sceneBoneName('hand.R')).toBe('handR');
    expect(sceneBoneName('chest')).toBe('chest');
    expect(sceneBoneName('a b')).toBe('a_b');
    expect(sceneBoneName('a[0]:b/c')).toBe('a0bc');
  });

  it('lets the socket table validate against a loaded rig', () => {
    // Before this, every dotted bone read as missing the moment the check was
    // pointed at a real scene rather than the authored mirror.
    const loaded = RIG_BONES.map(sceneBoneName);
    expect(validateAgainstRig(loaded)).toEqual([]);
    expect(validateAgainstRig(RIG_BONES)).toEqual([]);
  });

  it('still reports a bone that is genuinely absent', () => {
    expect(validateAgainstRig(['hips', 'chest'])).toContain('hand.R');
  });
});
