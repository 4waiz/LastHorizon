/** Small pure maths helpers. Deliberately dependency-free so they can be
 *  unit tested without a WebGL context. */

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function saturate(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Hermite fade between two edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = saturate(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = saturate(invLerp(edge0, edge1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Frame-rate independent approach-a-target factor.
 *
 * `x += (target - x) * damp(lambda, dt)` converges at the same real-world
 * rate whether the game runs at 30 or 144 fps, unlike a raw lerp constant.
 */
export function damp(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export function dampTowards(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * damp(lambda, dt);
}

/**
 * Wrap an angle into [-PI, PI).
 *
 * Note the half-open end: an exact half turn normalises to -PI, so
 * `angleDelta` resolves a perfect 180 degree turn consistently one way rather
 * than flip-flopping between frames.
 */
export function wrapAngle(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

/** Shortest signed difference from `a` to `b`. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return wrapAngle(current + angleDelta(current, target) * damp(lambda, dt));
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Deterministic 32-bit PRNG (mulberry32). Same seed, same world, always. */
export class Rng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1 - 1e-9));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }

  /** +/- amount */
  jitter(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }
}

function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1]. Cheap, deterministic, good enough for terrain. */
export function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

/** Fractal sum of value noise, normalised to roughly [0,1]. */
export function fbm2D(x: number, y: number, octaves = 4, gain = 0.5, lacunarity = 2.0): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
