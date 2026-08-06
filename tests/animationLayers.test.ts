import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AnimationLayers, MAX_FOOT_LIFT, footOffset } from '../src/player/AnimationLayers';
import {
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
    expect(socket('carry')?.bone).toBe('spine_02');
    expect(socket('phone')?.bone).toBe('hand_r');
    expect(socket('nonexistent' as never)).toBeNull();
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
    const missing = validateAgainstRig(['hips', 'spine_02']);
    expect(missing).toContain('hand_r');
    expect(missing).not.toContain('hips');
  });

  it('passes when the rig has every bone the table names', () => {
    expect(validateAgainstRig(requiredBones())).toEqual([]);
  });
});
