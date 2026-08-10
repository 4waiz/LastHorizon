import type { Vec3Like } from '../nav/NavTypes';

/**
 * Where the world stops, and what it says about it.
 *
 * The brief is explicit and it is the right instinct: **never an invisible
 * wall without feedback**. A player who flies into nothing and bounces has
 * found a bug; a player who is told the airspace ends, then turned around by
 * something they can see, has found a rule. Same geometry, completely
 * different experience, and the difference is entirely in the warning.
 *
 * So the boundary is four zones rather than a line:
 *
 *   1. **Inside.** Nothing happens.
 *   2. **Advisory.** A caption, once. "The valley narrows ahead." Still free.
 *   3. **Turning.** A visible cue — haze thickening, the return corridor
 *      marker — plus a gentle heading nudge back toward the middle. The
 *      player keeps control and can fly along the edge indefinitely.
 *   4. **Recovery.** Only reached by ignoring both warnings, or by falling out
 *      of the world entirely. Fades, places the vehicle at the nearest safe
 *      checkpoint, and hands back control.
 *
 * The same four apply on the ground, at sea, and in the air; only the
 * *presentation* differs, and that is the host's business rather than this
 * module's. This file decides and never draws.
 *
 * Clockless, like everything else in this repository that decides things:
 * `evaluate()` is a pure function of a position and a velocity.
 */

export type BoundaryZone = 'inside' | 'advisory' | 'turning' | 'recovery';

/** Why the world is asking the player to turn round. Drives the caption. */
export type BoundaryReason =
  /** Flew past the edge of the playable map. */
  | 'airspace'
  /** Climbed above the safe ceiling. */
  | 'ceiling'
  /** Out past the coastal limit. */
  | 'sea'
  /** Below the world floor — fell through, or sank. */
  | 'underworld';

export interface BoundaryVerdict {
  readonly zone: BoundaryZone;
  readonly reason: BoundaryReason | null;
  /**
   * 0 at the advisory edge, 1 at the recovery edge. The host uses it to thicken
   * haze and raise the warning's urgency, so the feedback is continuous rather
   * than three discrete states.
   */
  readonly pressure: number;
  /**
   * Unit vector pointing back toward safety, or null inside. The host applies
   * it as a *nudge*, never as a teleport — a player fighting it should win
   * right up until `recovery`.
   */
  readonly back: Vec3Like | null;
  /** Player-facing line. Never empty when the zone is not `inside`. */
  readonly caption: string;
}

export interface BoundsConfig {
  /** Playable rectangle, in world metres. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** Safe ceiling. Above this the air gets thin and the game says so. */
  readonly ceiling: number;
  /** Below this the player has left the world and is recovered immediately. */
  readonly floor: number;
  /** Metres inside the edge where the advisory starts. */
  readonly advisoryMargin: number;
  /** Metres inside the edge where the turn-back nudge starts. */
  readonly turningMargin: number;
}

/**
 * The flight corridor.
 *
 * Deliberately smaller than the streamed world and much smaller than the
 * terrain. The aeroplane can see for kilometres, so letting it fly to the
 * literal edge of the heightfield would mean either streaming every chunk in
 * the game or showing the player where the map runs out. A corridor that is
 * comfortably inside both is the honest answer, and the mountains and haze in
 * `presentation` are what make it feel chosen rather than imposed.
 */
/*
 * Derived from the zone bounds in `worldManifest.ts`, not chosen by feel. The
 * five zones span X -128..384 and Z -192..240; the corridor must contain all
 * of that *plus* the advisory margin, or a checkpoint inside a real zone lands
 * the player in a warning band the moment they are recovered — which is what
 * `worldBounds.test.ts` caught on the downtown kerb.
 */
/*
 * Sized from how far an aeroplane actually gets, not from the zone bounds.
 *
 * The first version enclosed the world plus a margin and came out about a
 * kilometre across. That is seventeen seconds of straight flight at 34 m/s
 * before the first warning, and the first in-game circuit was recovered
 * during its initial climb — twice, from two different headings.
 *
 * A turn is not the problem: at cruise with the assisted bank limit the radius
 * is about 72 m, so a circuit round the airfield is 150 m across and fits
 * anywhere. It is *straight* flight that needs room, and a player who points
 * the nose at the horizon deserves more than a quarter of a minute.
 *
 * 2.1 km square gives roughly a minute corner to corner. It is still very much
 * a corridor — the brief asks for one — but it is one you have to mean to
 * leave. Everything the player can actually land on stays near the middle.
 */
export const FLIGHT_CORRIDOR: BoundsConfig = {
  minX: -900,
  maxX: 1200,
  minZ: -1000,
  maxZ: 1100,
  ceiling: 620,
  floor: -40,
  advisoryMargin: 200,
  turningMargin: 90,
};

/** On foot and on wheels the world is the streamed zones, which are smaller. */
export const GROUND_BOUNDS: BoundsConfig = {
  minX: -200,
  maxX: 440,
  minZ: -250,
  maxZ: 300,
  ceiling: 400,
  floor: -25,
  advisoryMargin: 40,
  turningMargin: 16,
};

const CAPTIONS: Record<BoundaryReason, { advisory: string; turning: string }> = {
  airspace: {
    advisory: 'The valley narrows ahead. Best turn back soon.',
    turning: 'Turning back — the pass is closed this way.',
  },
  ceiling: {
    advisory: 'The air is getting thin up here.',
    turning: 'Too high. Bringing the nose down.',
  },
  sea: {
    advisory: 'Open water ahead, and no fuel to cross it.',
    turning: 'Coming about — nothing out there but sea.',
  },
  underworld: {
    advisory: '',
    turning: '',
  },
};

const norm = (x: number, y: number, z: number): Vec3Like => {
  const l = Math.hypot(x, y, z);
  return l < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: x / l, y: y / l, z: z / l };
};

const INSIDE: BoundaryVerdict = {
  zone: 'inside',
  reason: null,
  pressure: 0,
  back: null,
  caption: '',
};

/**
 * Which zone a point is in, why, and which way is home.
 *
 * The horizontal test uses the *worst* of the four edges rather than the
 * distance to the rectangle, because a player heading for a corner is closer
 * to leaving than either edge alone suggests.
 */
export function evaluate(
  at: Vec3Like,
  cfg: BoundsConfig = FLIGHT_CORRIDOR,
): BoundaryVerdict {
  // Falling out of the world is not a warning, it is a recovery. There is
  // nowhere to nudge somebody who is below the terrain.
  if (at.y < cfg.floor) {
    return {
      zone: 'recovery',
      reason: 'underworld',
      pressure: 1,
      back: { x: 0, y: 1, z: 0 },
      caption: '',
    };
  }

  // How far inside each edge, in metres. Negative means already outside.
  const dxLo = at.x - cfg.minX;
  const dxHi = cfg.maxX - at.x;
  const dzLo = at.z - cfg.minZ;
  const dzHi = cfg.maxZ - at.z;
  const dCeil = cfg.ceiling - at.y;

  const worstH = Math.min(dxLo, dxHi, dzLo, dzHi);
  const worst = Math.min(worstH, dCeil);

  if (worst > cfg.advisoryMargin) return INSIDE;

  // The reason is whichever edge is closest, so the caption matches the thing
  // the player can actually see coming.
  let reason: BoundaryReason;
  if (dCeil <= worstH) {
    reason = 'ceiling';
  } else if (dzLo === worstH) {
    // The coast runs along -Z: `city_waterfront` occupies Z -192..-48 and
    // there is nothing beyond it. Every other edge is hills, and +X in
    // particular is the airstrip and the ridge behind it.
    reason = 'sea';
  } else {
    reason = 'airspace';
  }

  // Back toward the middle. Only the axes that are actually in trouble
  // contribute, so a player near one edge is not shoved diagonally.
  let bx = 0;
  let by = 0;
  let bz = 0;
  if (dxLo <= cfg.advisoryMargin) bx += 1;
  if (dxHi <= cfg.advisoryMargin) bx -= 1;
  if (dzLo <= cfg.advisoryMargin) bz += 1;
  if (dzHi <= cfg.advisoryMargin) bz -= 1;
  if (dCeil <= cfg.advisoryMargin) by -= 1;

  const pressure = Math.min(
    1,
    Math.max(0, (cfg.advisoryMargin - worst) / Math.max(1, cfg.advisoryMargin)),
  );

  if (worst <= 0) {
    return {
      zone: 'recovery',
      reason,
      pressure: 1,
      back: norm(bx, by, bz),
      caption: CAPTIONS[reason].turning,
    };
  }

  if (worst <= cfg.turningMargin) {
    return {
      zone: 'turning',
      reason,
      pressure,
      back: norm(bx, by, bz),
      caption: CAPTIONS[reason].turning,
    };
  }

  return {
    zone: 'advisory',
    reason,
    pressure,
    back: norm(bx, by, bz),
    caption: CAPTIONS[reason].advisory,
  };
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export interface Checkpoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly facing: number;
  /** Which vehicles may be put back here. A plane cannot recover to a jetty. */
  readonly accepts: readonly ('foot' | 'ground' | 'air' | 'water')[];
}

/**
 * Somewhere safe to be put back.
 *
 * Authored rather than derived. A recovery point computed from the nearest
 * navmesh polygon puts an aeroplane in a hedge and a boat on a beach, and the
 * one thing a recovery must never do is need another recovery.
 */
export const CHECKPOINTS: readonly Checkpoint[] = [
  { id: 'airstrip_apron', x: 176, y: 0, z: 0, facing: Math.PI / 2, accepts: ['air', 'ground', 'foot'] },
  { id: 'airstrip_hold', x: 152, y: 0, z: -18, facing: Math.PI / 2, accepts: ['air', 'ground', 'foot'] },
  { id: 'village_road', x: 0, y: 0, z: 30, facing: 0, accepts: ['ground', 'foot'] },
  { id: 'village_square', x: -8, y: 0, z: 54, facing: 0, accepts: ['foot'] },
  { id: 'market_gate', x: 14, y: 0, z: 18, facing: Math.PI, accepts: ['ground', 'foot'] },
  { id: 'waterfront_dock', x: -24, y: 0, z: -120, facing: 0, accepts: ['water', 'foot'] },
  { id: 'waterfront_slip', x: -30, y: 0, z: -112, facing: 0, accepts: ['water', 'foot'] },
  { id: 'downtown_kerb', x: 26, y: 0, z: 150, facing: Math.PI, accepts: ['ground', 'foot'] },
];

export type RecoveryKind = 'foot' | 'ground' | 'air' | 'water';

/**
 * The nearest checkpoint that will take this kind of vehicle.
 *
 * Never returns null: the list always contains at least one entry per kind,
 * and `recoveryTest.ts` asserts that, because a recovery that cannot find
 * anywhere to go is the failure this whole module exists to prevent.
 */
export function nearestCheckpoint(at: Vec3Like, kind: RecoveryKind): Checkpoint {
  let best: Checkpoint | null = null;
  let bestD = Infinity;
  for (const c of CHECKPOINTS) {
    if (!c.accepts.includes(kind)) continue;
    const d = (c.x - at.x) ** 2 + (c.z - at.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // The fallback is the airstrip apron, which accepts everything that flies or
  // rolls; `foot` and `water` are covered by their own entries above.
  return best ?? CHECKPOINTS[0];
}
