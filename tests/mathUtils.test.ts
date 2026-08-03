import { describe, it, expect } from 'vitest';
import {
  clamp,
  lerp,
  invLerp,
  smoothstep,
  damp,
  dampTowards,
  wrapAngle,
  angleDelta,
  dampAngle,
  moveTowards,
  Rng,
  valueNoise2D,
  fbm2D,
  TAU,
} from '../src/utils/MathUtils';

describe('scalar helpers', () => {
  it('clamps to the range', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('lerps and inverts', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(invLerp(10, 20, 15)).toBe(0.5);
    expect(invLerp(4, 4, 9)).toBe(0);
  });

  it('smoothsteps with flat ends', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('moveTowards never overshoots', () => {
    expect(moveTowards(0, 10, 3)).toBe(3);
    expect(moveTowards(0, 2, 3)).toBe(2);
    expect(moveTowards(0, -2, 3)).toBe(-2);
  });
});

describe('damp', () => {
  it('is frame-rate independent', () => {
    // One 0.1 s step must land in the same place as ten 0.01 s steps.
    const lambda = 8;
    const oneStep = 0 + (1 - 0) * damp(lambda, 0.1);

    let many = 0;
    for (let i = 0; i < 10; i++) many = dampTowards(many, 1, lambda, 0.01);

    expect(many).toBeCloseTo(oneStep, 6);
  });

  it('returns 0 for dt 0 and approaches 1 for long dt', () => {
    expect(damp(8, 0)).toBe(0);
    expect(damp(8, 100)).toBeCloseTo(1, 6);
  });
});

describe('angles', () => {
  it('wraps into [-PI, PI)', () => {
    expect(wrapAngle(0.5)).toBeCloseTo(0.5, 6);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 6);
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 6);
    // A half turn lands on the -PI end of the half-open range.
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 6);
    for (let i = -20; i <= 20; i++) {
      const v = wrapAngle(i * 0.9);
      expect(v).toBeGreaterThanOrEqual(-Math.PI);
      expect(v).toBeLessThan(Math.PI);
    }
  });

  it('preserves direction modulo a full turn', () => {
    for (let i = -5; i <= 5; i++) {
      expect(Math.cos(wrapAngle(1.234 + i * TAU))).toBeCloseTo(Math.cos(1.234), 9);
      expect(Math.sin(wrapAngle(1.234 + i * TAU))).toBeCloseTo(Math.sin(1.234), 9);
    }
  });

  it('takes the short way round', () => {
    // 350deg -> 10deg is +20deg, not -340deg.
    const a = (350 * Math.PI) / 180;
    const b = (10 * Math.PI) / 180;
    expect((angleDelta(a, b) * 180) / Math.PI).toBeCloseTo(20, 4);
  });

  it('damps across the seam without spinning', () => {
    let a = Math.PI - 0.05;
    const target = -Math.PI + 0.05;
    for (let i = 0; i < 60; i++) a = dampAngle(a, target, 12, 1 / 60);
    expect(Math.abs(angleDelta(a, target))).toBeLessThan(0.02);
    // and it must stay wrapped, not accumulate past PI
    expect(Math.abs(a)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds and stays in [0,1)', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
    const r = new Rng(99);
    for (let i = 0; i < 500; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('respects range and int bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 300; i++) {
      const v = r.range(-3, 5);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(5);
      const n = r.int(2, 4);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe('noise', () => {
  it('stays in [0,1] and is continuous', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const v = valueNoise2D(x, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Neighbouring samples must not jump — terrain depends on this.
    for (let i = 0; i < 100; i++) {
      const x = i * 0.13;
      const a = valueNoise2D(x, 4.2);
      const b = valueNoise2D(x + 0.01, 4.2);
      expect(Math.abs(a - b)).toBeLessThan(0.06);
    }
  });

  it('fbm is repeatable and bounded', () => {
    expect(fbm2D(1.5, 2.5)).toBe(fbm2D(1.5, 2.5));
    for (let i = 0; i < 100; i++) {
      const v = fbm2D(i * 0.21, i * 0.33);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
