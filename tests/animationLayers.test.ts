import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AnimationLayers, MAX_FOOT_LIFT, footOffset } from '../src/player/AnimationLayers';
import {
  RIG_BONES,
  SOCKETS,
  requiredBones,
  socket,
  socketsAvailableIn,
  validateAgainstRig,
} from '../src/player/Sockets';

/** A clip that moves one bone, so layers can be told apart. */
function clip(name: string, track = '.position'): THREE.AnimationClip {
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack(`bone${track}`, [0, 1], [0, 0, 0, 0, 1, 0]),
  ]);
}

function layers(names: string[]): AnimationLayers {
  const root = new THREE.Object3D();
  root.name = 'root';
  const bone = new THREE.Object3D();
  bone.name = 'bone';
  root.add(bone);
  return new AnimationLayers(new THREE.AnimationMixer(root), names.map((n) => clip(n)));
}

describe('layer playback', () => {
  it('reports the clips it was given', () => {
    const l = layers(['Idle', 'Walk']);
    expect(l.clipNames).toEqual(['Idle', 'Walk']);
    expect(l.has('Idle')).toBe(true);
    expect(l.has('Nope')).toBe(false);
  });

  it('degrades rather than throwing on a missing clip', () => {
    const l = layers(['Idle']);
    expect(l.play('upperBody', 'CarryBox')).toBe(false);
    expect(l.playing('upperBody')).toBeNull();
  });

  it('plays a base clip at full weight', () => {
    const l = layers(['Idle']);
    expect(l.play('locomotion', 'Idle')).toBe(true);
    l.update(0.016);
    expect(l.playing('locomotion')).toBe('Idle');
    expect(l.weight('locomotion')).toBeCloseTo(1, 3);
  });

  it('runs an upper-body clip alongside the base', () => {
    const l = layers(['Idle', 'CarryBox']);
    l.play('locomotion', 'Idle');
    l.play('upperBody', 'CarryBox');
    l.setWeight('upperBody', 1, 0.1);
    for (let i = 0; i < 20; i++) l.update(0.016);

    // Both layers are live at once -- that is the point of masking in-clip.
    expect(l.playing('locomotion')).toBe('Idle');
    expect(l.playing('upperBody')).toBe('CarryBox');
    expect(l.weight('upperBody')).toBeCloseTo(1, 2);
  });

  it('is a no-op when asked to replay what is already playing', () => {
    const l = layers(['Idle']);
    l.play('locomotion', 'Idle');
    l.update(0.5);
    expect(l.play('locomotion', 'Idle')).toBe(true);
    expect(l.playing('locomotion')).toBe('Idle');
  });
});

describe('additive layer', () => {
  /**
   * A rig plus a clip whose first frame is *not* the rest pose, so that
   * subtracting the reference frame is observable. With y running 1 -> 2, one
   * additive conversion leaves 0 -> 1; a second would leave -1 -> 0.
   */
  function offsetRig() {
    const root = new THREE.Object3D();
    root.name = 'root';
    const bone = new THREE.Object3D();
    bone.name = 'bone';
    root.add(bone);

    const offset = new THREE.AnimationClip('Wave', 1, [
      new THREE.VectorKeyframeTrack('bone.position', [0, 1], [0, 1, 0, 0, 2, 0]),
    ]);
    const idle = clip('Idle');
    return {
      l: new AnimationLayers(new THREE.AnimationMixer(root), [idle, offset]),
      bone,
      offset,
    };
  }

  it('leaves the source clip untouched', () => {
    // makeClipAdditive rewrites track values in place. Converting the live
    // clip would mean the same animation could never be played normally
    // again -- on this rig or anything else sharing the GLB's clips.
    const { l, offset } = offsetRig();
    const before = Array.from(offset.tracks[0].values);

    l.play('additive', 'Wave');
    l.setWeight('additive', 1, 0);
    l.update(0.016);

    expect(Array.from(offset.tracks[0].values)).toEqual(before);
    expect(offset.blendMode).not.toBe(THREE.AdditiveAnimationBlendMode);
  });

  it('does not re-subtract the reference frame when replayed', () => {
    const { l, bone } = offsetRig();

    l.play('additive', 'Wave');
    l.setWeight('additive', 1, 0);
    l.update(0.001);
    const first = bone.position.y;
    // Reference frame subtracted exactly once: starts at rest, not at +1.
    expect(first).toBeCloseTo(0, 2);

    // Fade out fully so the slot is released, then play it again.
    l.stop('additive', 0);
    for (let i = 0; i < 5; i++) l.update(0.016);
    expect(l.playing('additive')).toBeNull();

    l.play('additive', 'Wave');
    l.setWeight('additive', 1, 0);
    l.update(0.001);
    // A second conversion would put this at -1.
    expect(bone.position.y).toBeCloseTo(first, 2);
  });

  it('runs a wave over locomotion without stopping it', () => {
    const { l } = offsetRig();
    l.play('locomotion', 'Idle');
    l.play('additive', 'Wave');
    l.setWeight('additive', 1, 0.1);
    for (let i = 0; i < 20; i++) l.update(0.016);

    expect(l.playing('locomotion')).toBe('Idle');
    expect(l.playing('additive')).toBe('Wave');
  });
});

describe('weights ramp instead of snapping', () => {
  it('fades an upper-body layer in over the requested time', () => {
    const l = layers(['Idle', 'Phone']);
    l.play('locomotion', 'Idle');
    l.play('upperBody', 'Phone');
    l.setWeight('upperBody', 1, 1);

    l.update(0.25);
    const quarter = l.weight('upperBody');
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(1);

    for (let i = 0; i < 60; i++) l.update(0.016);
    expect(l.weight('upperBody')).toBeCloseTo(1, 2);
  });

  it('releases the layer once it has faded out', () => {
    const l = layers(['Idle', 'Phone']);
    l.play('upperBody', 'Phone');
    l.setWeight('upperBody', 1, 0);
    l.update(0.016);
    l.stop('upperBody', 0.2);
    for (let i = 0; i < 30; i++) l.update(0.016);
    expect(l.playing('upperBody')).toBeNull();
    expect(l.weight('upperBody')).toBe(0);
  });

  it('resumes from where an interrupted fade got to, rather than popping', () => {
    const l = layers(['Idle', 'Phone']);
    l.play('upperBody', 'Phone');
    l.setWeight('upperBody', 1, 0);
    l.update(0.016);

    // Start fading out, then change our mind half way.
    l.stop('upperBody', 1);
    l.update(0.5);
    const half = l.weight('upperBody');
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.8);

    l.setWeight('upperBody', 1, 1);
    l.update(0.016);
    // Continues upward from `half` -- no snap to 0 and no jump to 1.
    const after = l.weight('upperBody');
    expect(after).toBeGreaterThan(half);
    expect(after).toBeLessThan(half + 0.1);
  });

  it('clamps a weight request into 0..1', () => {
    const l = layers(['Idle', 'Phone']);
    l.play('upperBody', 'Phone');
    l.setWeight('upperBody', 99, 0);
    l.update(0.016);
    expect(l.weight('upperBody')).toBeLessThanOrEqual(1);
  });
});

describe('procedural foot placement', () => {
  it('is zero on flat ground', () => {
    expect(footOffset(0, 0)).toBe(0);
  });

  it('lifts a foot toward ground above it', () => {
    expect(footOffset(0.05, 0)).toBeCloseTo(0.05, 6);
  });

  it('drops a foot toward ground below it', () => {
    expect(footOffset(-0.05, 0)).toBeCloseTo(-0.05, 6);
  });

  it('clamps hard, because a big correction reads as a broken leg', () => {
    expect(footOffset(10, 0)).toBe(MAX_FOOT_LIFT);
    expect(footOffset(-10, 0)).toBe(-MAX_FOOT_LIFT);
  });

  it('scales by the blend so it can be faded out in the air', () => {
    expect(footOffset(0.08, 0, 0)).toBe(0);
    expect(footOffset(0.08, 0, 0.5)).toBeCloseTo(0.04, 6);
  });

  it('returns zero rather than NaN for a failed raycast', () => {
    expect(footOffset(Number.NaN, 0)).toBe(0);
    expect(footOffset(0, Number.NaN)).toBe(0);
  });
});

describe('sockets', () => {
  it('resolves by id', () => {
    expect(socket('carry')?.bone).toBe('chest');
    expect(socket('phone')?.bone).toBe('hand.R');
    expect(socket('nonexistent' as never)).toBeNull();
  });

  it('every socket names a bone the authored rig actually has', () => {
    // The bug this catches shipped the moment the table was written: it said
    // spine_02 and hand_r, the rig says chest and hand.R.
    expect(validateAgainstRig(RIG_BONES)).toEqual([]);
  });

  it('has no duplicate ids', () => {
    const ids = SOCKETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks reach-targets as targets and held things as not', () => {
    // The hand follows a steering wheel; a phone follows the hand.
    expect(socket('steering_wheel')?.isTarget).toBe(true);
    expect(socket('phone')?.isTarget).toBe(false);
  });

  it('separates what is usable now from what later phases bring', () => {
    const now = socketsAvailableIn(4).map((s) => s.id);
    expect(now).toContain('carry');
    expect(now).toContain('phone');
    // Vehicles are Phase 5, weapons Phase 9 -- declared, not yet usable.
    expect(now).not.toContain('steering_wheel');
    expect(now).not.toContain('weapon');
    expect(socketsAvailableIn(9).map((s) => s.id)).toContain('weapon');
  });

  it('catches a socket pointing at a bone the rig does not have', () => {
    const missing = validateAgainstRig(['hips', 'chest']);
    expect(missing).toContain('hand.R');
    expect(missing).not.toContain('hips');
  });

  it('passes when the rig has every bone the table names', () => {
    expect(validateAgainstRig(requiredBones())).toEqual([]);
  });
});
