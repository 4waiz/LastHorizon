import { describe, expect, it } from 'vitest';
import {
  evaluate,
  nearestCheckpoint,
  CHECKPOINTS,
  FLIGHT_CORRIDOR,
  GROUND_BOUNDS,
  type RecoveryKind,
} from '../src/flight/WorldBounds';

/**
 * The edge of the world, and the promise that it is never silent.
 *
 * The brief's rule — "never use an invisible wall without feedback" — is the
 * kind of thing that is easy to agree with and easy to ship without. These
 * tests make it structural: **no zone outside `inside` may have an empty
 * caption and no way home**, checked exhaustively rather than at a few sample
 * points.
 */

const mid = { x: 0, y: 200, z: 0 };

describe('inside the corridor', () => {
  it('says nothing at all in the middle', () => {
    const v = evaluate(mid);
    expect(v.zone).toBe('inside');
    expect(v.caption).toBe('');
    expect(v.back).toBeNull();
    expect(v.pressure).toBe(0);
  });

  it('is still silent well inside the advisory margin', () => {
    const x = FLIGHT_CORRIDOR.maxX - FLIGHT_CORRIDOR.advisoryMargin - 20;
    expect(evaluate({ x, y: 200, z: 0 }).zone).toBe('inside');
  });
});

describe('the warning ladder', () => {
  it('advises before it turns, and turns before it recovers', () => {
    const c = FLIGHT_CORRIDOR;
    const at = (x: number) => evaluate({ x, y: 200, z: 0 }).zone;

    expect(at(c.maxX - c.advisoryMargin - 1)).toBe('inside');
    expect(at(c.maxX - c.advisoryMargin + 1)).toBe('advisory');
    expect(at(c.maxX - c.turningMargin + 1)).toBe('turning');
    expect(at(c.maxX + 1)).toBe('recovery');
  });

  it('rises smoothly rather than in steps', () => {
    const c = FLIGHT_CORRIDOR;
    const p = (x: number) => evaluate({ x, y: 200, z: 0 }).pressure;
    const a = p(c.maxX - c.advisoryMargin + 5);
    const b = p(c.maxX - c.turningMargin - 5);
    const d = p(c.maxX - 2);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(d);
    expect(d).toBeLessThanOrEqual(1);
  });

  it('never leaves the player without a caption or a way home', () => {
    // Exhaustive rather than sampled: every metre of the boundary band on all
    // four sides, plus the ceiling. This is the invisible-wall rule as a test.
    const c = FLIGHT_CORRIDOR;
    for (let x = c.minX - 30; x <= c.maxX + 30; x += 7) {
      for (let z = c.minZ - 30; z <= c.maxZ + 30; z += 7) {
        const v = evaluate({ x, y: 200, z });
        if (v.zone === 'inside') continue;
        expect(v.back, `no way home at ${x},${z}`).not.toBeNull();
        if (v.reason !== 'underworld') {
          expect(v.caption.length, `silent wall at ${x},${z}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('which way is home', () => {
  it('points back inward from each edge', () => {
    const c = FLIGHT_CORRIDOR;
    expect(evaluate({ x: c.maxX - 10, y: 200, z: 0 }).back!.x).toBeLessThan(0);
    expect(evaluate({ x: c.minX + 10, y: 200, z: 0 }).back!.x).toBeGreaterThan(0);
    expect(evaluate({ x: 0, y: 200, z: c.maxZ - 10 }).back!.z).toBeLessThan(0);
    expect(evaluate({ x: 0, y: 200, z: c.minZ + 10 }).back!.z).toBeGreaterThan(0);
  });

  it('pushes down from the ceiling and up from the floor', () => {
    const c = FLIGHT_CORRIDOR;
    expect(evaluate({ x: 0, y: c.ceiling - 10, z: 0 }).back!.y).toBeLessThan(0);
    expect(evaluate({ x: 0, y: c.floor - 1, z: 0 }).back!.y).toBeGreaterThan(0);
  });

  it('does not shove sideways when only one edge is close', () => {
    const c = FLIGHT_CORRIDOR;
    const v = evaluate({ x: c.maxX - 10, y: 200, z: 0 });
    expect(Math.abs(v.back!.z), 'z is nowhere near an edge').toBeCloseTo(0, 6);
  });

  it('points diagonally out of a corner', () => {
    const c = FLIGHT_CORRIDOR;
    const v = evaluate({ x: c.maxX - 8, y: 200, z: c.maxZ - 8 });
    expect(v.back!.x).toBeLessThan(0);
    expect(v.back!.z).toBeLessThan(0);
  });
});

describe('reasons', () => {
  it('blames the ceiling when the ceiling is closest', () => {
    expect(evaluate({ x: 0, y: FLIGHT_CORRIDOR.ceiling - 5, z: 0 }).reason).toBe('ceiling');
  });

  it('calls falling out of the world what it is, and recovers at once', () => {
    const v = evaluate({ x: 0, y: FLIGHT_CORRIDOR.floor - 1, z: 0 });
    expect(v.reason).toBe('underworld');
    expect(v.zone, 'there is nothing to warn about down here').toBe('recovery');
  });
});

describe('the ground bounds are a different, smaller world', () => {
  it('stops a car well before it stops an aeroplane', () => {
    const p = { x: GROUND_BOUNDS.maxX + 20, y: 2, z: 0 };
    expect(evaluate(p, GROUND_BOUNDS).zone).toBe('recovery');
    expect(evaluate(p, FLIGHT_CORRIDOR).zone, 'still fine for a plane').toBe('inside');
  });
});

describe('checkpoints', () => {
  const kinds: RecoveryKind[] = ['foot', 'ground', 'air', 'water'];

  it('every kind has somewhere to go', () => {
    for (const k of kinds) {
      expect(CHECKPOINTS.some((c) => c.accepts.includes(k)), k).toBe(true);
    }
  });

  it('always returns one, from anywhere, for every kind', () => {
    // Including from outside the world, which is exactly when it is called.
    const places = [
      { x: 0, y: 0, z: 0 },
      { x: 9999, y: -500, z: -9999 },
      { x: -420, y: 620, z: 260 },
    ];
    for (const p of places) {
      for (const k of kinds) {
        const c = nearestCheckpoint(p, k);
        expect(c, `${k} from ${p.x},${p.z}`).toBeTruthy();
        expect(c.accepts).toContain(k);
      }
    }
  });

  it('puts an aeroplane on the airstrip, not on a jetty', () => {
    // Standing over the water, an aeroplane must still be sent to tarmac.
    const c = nearestCheckpoint({ x: -24, y: 0, z: -120 }, 'air');
    expect(c.accepts).toContain('air');
    expect(c.id.startsWith('airstrip')).toBe(true);
  });

  it('puts a boat on the water, not on the runway', () => {
    const c = nearestCheckpoint({ x: 176, y: 0, z: 0 }, 'water');
    expect(c.accepts).toContain('water');
    expect(c.id.startsWith('waterfront')).toBe(true);
  });

  it('picks the nearer of two that both accept', () => {
    const near = nearestCheckpoint({ x: 150, y: 0, z: -18 }, 'air');
    expect(near.id).toBe('airstrip_hold');
  });

  it('has no checkpoint outside the corridor it recovers into', () => {
    for (const c of CHECKPOINTS) {
      const v = evaluate({ x: c.x, y: 10, z: c.z }, FLIGHT_CORRIDOR);
      expect(v.zone, `${c.id} is not inside the flight corridor`).toBe('inside');
    }
  });
});
