import type { Point2 } from './LaneGraph';

/**
 * The decisions traffic makes, as arithmetic.
 *
 * Split out from `TrafficSystem` because these are the parts worth testing and
 * none of them need a scene: how hard to brake for the car in front, whether a
 * junction is clear, and — the one with a stated acceptance criterion attached
 * — whether a spawn point is somewhere the player can see.
 */

/** Comfortable deceleration, m/s^2. A calm sandbox, not an emergency stop. */
export const BRAKE = 4.2;
export const ACCELERATE = 2.4;
/** Bumper-to-bumper gap held at rest, metres. */
export const STANDSTILL_GAP = 3.4;
/** Seconds of headway held at speed, on top of the standstill gap. */
export const HEADWAY = 1.35;

export interface FollowInput {
  readonly limit: number;
  readonly speed: number;
  /** Distance to whatever is directly ahead in this lane, or Infinity. */
  readonly gapAhead: number;
  /** That obstacle's speed. Zero for a parked car, a wall or a pedestrian. */
  readonly leadSpeed: number;
  /** Distance to a hard stop line — a red light or a give-way. Infinity if none. */
  readonly stopAhead: number;
}

/**
 * Target speed for this instant.
 *
 * Two independent constraints, and the lower wins: keep a sane gap to the car
 * in front, and be able to stop by the stop line. The stop-line term uses
 * `v = sqrt(2 a d)` — the fastest a vehicle can be going and still stop in the
 * distance remaining — which is what makes a car ease up to a red light
 * instead of driving at it and then braking through the floor.
 */
export function desiredSpeed(input: FollowInput): number {
  const { limit, speed, gapAhead, leadSpeed, stopAhead } = input;
  let target = limit;

  if (Number.isFinite(gapAhead)) {
    const wanted = STANDSTILL_GAP + HEADWAY * speed;
    if (gapAhead <= wanted) {
      // Inside the desired gap: match the lead and give some of it back.
      target = Math.min(target, Math.max(0, leadSpeed * (gapAhead / Math.max(wanted, 0.01))));
    } else {
      // Outside it: close at a rate proportional to the surplus, capped.
      target = Math.min(target, leadSpeed + (gapAhead - wanted) * 0.9);
    }
  }

  if (Number.isFinite(stopAhead)) {
    const margin = Math.max(0, stopAhead - 1.2);
    target = Math.min(target, Math.sqrt(2 * BRAKE * margin));
  }

  return Math.max(0, Math.min(target, limit));
}

/** Move `speed` toward `target` under the acceleration limits. */
export function integrateSpeed(speed: number, target: number, dt: number): number {
  if (target > speed) return Math.min(target, speed + ACCELERATE * dt);
  return Math.max(target, speed - BRAKE * dt);
}

// ---------------------------------------------------------------------------
// Spawn safety
// ---------------------------------------------------------------------------

/** Half-angle of the cone counted as "in view", radians. Generous on purpose. */
export const VIEW_CONE = (75 * Math.PI) / 180;
/** Beyond this, popping in is not noticeable even head-on. */
export const VIEW_DISTANCE = 95;

/**
 * Would the player see this appear?
 *
 * Deliberately conservative in both directions. The cone is wider than the
 * camera's, because a player turning their head should not catch a car
 * materialising at the edge of frame; and the distance cut-off is generous,
 * because a spawn at 100 m is a dot.
 */
export function inPlayerView(
  player: Point2,
  facing: number,
  point: Point2,
  cone = VIEW_CONE,
  maxDistance = VIEW_DISTANCE,
): boolean {
  const dx = point.x - player.x;
  const dz = point.z - player.z;
  const distance = Math.hypot(dx, dz);
  if (distance > maxDistance) return false;
  if (distance < 1e-3) return true;

  const bearing = Math.atan2(dx, dz);
  let delta = (bearing - facing) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta) <= cone;
}

export interface BubbleRanges {
  /** Nearest a vehicle may be spawned. */
  readonly spawnMin: number;
  /** Furthest a vehicle may be spawned. */
  readonly spawnMax: number;
  /** Beyond this a vehicle is removed. Must exceed spawnMax, or it thrashes. */
  readonly despawn: number;
}

export const DEFAULT_BUBBLE: BubbleRanges = {
  spawnMin: 45,
  spawnMax: 110,
  despawn: 145,
};

export function canSpawnAt(
  player: Point2,
  facing: number,
  point: Point2,
  bubble: BubbleRanges = DEFAULT_BUBBLE,
): boolean {
  const distance = Math.hypot(point.x - player.x, point.z - player.z);
  if (distance < bubble.spawnMin || distance > bubble.spawnMax) return false;
  return !inPlayerView(player, facing, point);
}

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

/** Speed below which a vehicle that wants to move counts as stalled. */
export const STALL_SPEED = 0.2;
/** Seconds stalled before yields are ignored to break a standoff. */
export const STALL_BARGE_AFTER = 8;
/** Seconds stalled before the vehicle is removed outright. */
export const STALL_REMOVE_AFTER = 16;

export type WatchdogAction = 'none' | 'barge' | 'remove';

/**
 * What to do about a vehicle that has not moved.
 *
 * Deadlock in a lane network is not an exotic failure — two cars each waiting
 * for the other at a junction is the ordinary case, and it is permanent
 * without something like this. Barging first because it fixes the standoff
 * invisibly; removal second because a car that is *still* not moving after
 * sixteen seconds is wedged on geometry, and no amount of politeness gets it
 * out.
 */
export function watchdog(stalledSeconds: number): WatchdogAction {
  if (stalledSeconds >= STALL_REMOVE_AFTER) return 'remove';
  if (stalledSeconds >= STALL_BARGE_AFTER) return 'barge';
  return 'none';
}

// ---------------------------------------------------------------------------
// Deterministic sequence
// ---------------------------------------------------------------------------

/**
 * A tiny seeded generator.
 *
 * Traffic density has to be deterministic — the same seed, the same zone and
 * the same route give the same cars — so nothing here may reach for
 * `Math.random`. Mulberry32: 32 bits of state, good enough for choosing a
 * junction exit, and reproducible across machines.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
