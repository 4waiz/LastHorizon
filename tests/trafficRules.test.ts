import { describe, it, expect } from 'vitest';
import {
  ACCELERATE,
  BRAKE,
  DEFAULT_BUBBLE,
  HEADWAY,
  STALL_BARGE_AFTER,
  STALL_REMOVE_AFTER,
  STANDSTILL_GAP,
  canSpawnAt,
  desiredSpeed,
  inPlayerView,
  integrateSpeed,
  mulberry32,
  watchdog,
} from '../src/traffic/TrafficRules';

const open = { limit: 14, speed: 14, gapAhead: Infinity, leadSpeed: 0, stopAhead: Infinity };

describe('following', () => {
  it('runs at the limit on an empty road', () => {
    expect(desiredSpeed(open)).toBe(14);
  });

  it('never exceeds the limit, however much room there is', () => {
    expect(desiredSpeed({ ...open, gapAhead: 500, leadSpeed: 40 })).toBe(14);
  });

  it('slows for a slower car ahead', () => {
    const target = desiredSpeed({ ...open, gapAhead: 12, leadSpeed: 6 });
    expect(target).toBeLessThan(14);
  });

  it('stops behind a stationary car', () => {
    const target = desiredSpeed({ ...open, speed: 2, gapAhead: 1, leadSpeed: 0 });
    expect(target).toBeLessThan(0.6);
  });

  it('holds a wider gap at speed than at rest', () => {
    // The gap rule is standstill + headway * speed; at 14 m/s that is much
    // more than the 3.4 m held bumper to bumper.
    const atSpeed = STANDSTILL_GAP + HEADWAY * 14;
    expect(atSpeed).toBeGreaterThan(STANDSTILL_GAP * 4);
    expect(desiredSpeed({ ...open, gapAhead: atSpeed * 0.5, leadSpeed: 14 })).toBeLessThan(14);
  });

  it('never returns a negative speed', () => {
    for (const gap of [0, 0.1, 1, 5]) {
      expect(desiredSpeed({ ...open, gapAhead: gap, leadSpeed: 0 })).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('stop lines', () => {
  it('eases up to a red light rather than driving at it', () => {
    // v = sqrt(2 a d): the fastest you can be going and still stop in time.
    const far = desiredSpeed({ ...open, stopAhead: 40 });
    const near = desiredSpeed({ ...open, stopAhead: 8 });
    const onIt = desiredSpeed({ ...open, stopAhead: 1 });
    expect(far).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(onIt);
    expect(onIt).toBe(0);
  });

  it('can actually stop in the distance it allows itself', () => {
    for (const d of [3, 6, 12, 25]) {
      const v = desiredSpeed({ ...open, stopAhead: d });
      // Braking distance at that speed must fit inside what remains.
      expect((v * v) / (2 * BRAKE)).toBeLessThanOrEqual(d);
    }
  });

  it('takes the lower of the two constraints', () => {
    const both = desiredSpeed({ ...open, gapAhead: 5, leadSpeed: 2, stopAhead: 6 });
    expect(both).toBeLessThanOrEqual(desiredSpeed({ ...open, stopAhead: 6 }));
    expect(both).toBeLessThanOrEqual(desiredSpeed({ ...open, gapAhead: 5, leadSpeed: 2 }));
  });
});

describe('integrating speed', () => {
  it('respects the acceleration and braking limits', () => {
    expect(integrateSpeed(0, 14, 1)).toBeCloseTo(ACCELERATE, 6);
    expect(integrateSpeed(14, 0, 1)).toBeCloseTo(14 - BRAKE, 6);
  });

  it('never overshoots the target', () => {
    expect(integrateSpeed(13.9, 14, 1)).toBe(14);
    expect(integrateSpeed(0.1, 0, 1)).toBe(0);
  });
});

describe('spawn safety', () => {
  const player = { x: 0, z: 0 };
  const facing = 0; // looking down +Z

  it('counts what is in front as visible', () => {
    expect(inPlayerView(player, facing, { x: 0, z: 60 })).toBe(true);
  });

  it('counts what is behind as not visible', () => {
    expect(inPlayerView(player, facing, { x: 0, z: -60 })).toBe(false);
  });

  it('counts anything far enough away as not worth worrying about', () => {
    expect(inPlayerView(player, facing, { x: 0, z: 200 })).toBe(false);
  });

  it('uses a cone wider than the camera, so a head-turn catches nothing', () => {
    // 60 degrees off-centre is outside a typical FOV and still refused.
    const a = (60 * Math.PI) / 180;
    expect(inPlayerView(player, facing, { x: Math.sin(a) * 50, z: Math.cos(a) * 50 })).toBe(true);
  });

  it('refuses a spawn in view, at the acceptance criterion', () => {
    // "Do not spawn traffic directly in the player's view."
    expect(canSpawnAt(player, facing, { x: 0, z: 60 })).toBe(false);
  });

  it('allows a spawn behind the player, inside the bubble', () => {
    expect(canSpawnAt(player, facing, { x: 0, z: -60 })).toBe(true);
  });

  it('refuses a spawn too close even when it is behind', () => {
    expect(canSpawnAt(player, facing, { x: 0, z: -10 })).toBe(false);
  });

  it('refuses a spawn beyond the bubble', () => {
    expect(canSpawnAt(player, facing, { x: 0, z: -200 })).toBe(false);
  });

  it('leaves room between spawning and despawning, so nothing thrashes', () => {
    expect(DEFAULT_BUBBLE.despawn).toBeGreaterThan(DEFAULT_BUBBLE.spawnMax);
    expect(DEFAULT_BUBBLE.spawnMin).toBeLessThan(DEFAULT_BUBBLE.spawnMax);
  });
});

describe('the deadlock watchdog', () => {
  it('does nothing while traffic is moving', () => {
    expect(watchdog(0)).toBe('none');
    expect(watchdog(STALL_BARGE_AFTER - 0.1)).toBe('none');
  });

  it('barges through a standoff before giving up on it', () => {
    // Two cars each waiting for the other is the ordinary case at a junction,
    // and permanent without this.
    expect(watchdog(STALL_BARGE_AFTER)).toBe('barge');
    expect(watchdog(STALL_REMOVE_AFTER - 0.1)).toBe('barge');
  });

  it('removes a vehicle that is still stuck after barging', () => {
    expect(watchdog(STALL_REMOVE_AFTER)).toBe('remove');
    expect(watchdog(600)).toBe('remove');
  });

  it('tries politeness before force', () => {
    expect(STALL_BARGE_AFTER).toBeLessThan(STALL_REMOVE_AFTER);
  });
});

describe('the seeded generator', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('gives different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('stays inside [0, 1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
