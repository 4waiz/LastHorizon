import type { Vec3Like } from '../nav/NavTypes';

/**
 * Where a shot goes, and what it meets.
 *
 * Pure, and occlusion is **injected** exactly as it is in `Perception`: the
 * caller owns the collision world and passes in how far the nearest wall is,
 * so the whole matrix of cones, distances and people standing behind things is
 * unit-testable without a scene. That symmetry is deliberate — the two systems
 * answer the same question ("could this reach that?") and disagreeing about
 * walls would be a bug nobody could find.
 *
 * There is no damage model here. A hit reports *where* and *how far*, and the
 * composure arithmetic lives in `WeaponDefinition.impactAt`.
 */

export interface ShotTarget {
  readonly id: string;
  /** Centre of the torso, not the feet. */
  readonly at: Vec3Like;
  /** Torso radius. A person is treated as an upright capsule. */
  readonly radius: number;
  /** Full standing height, used to cap how high a hit can land. */
  readonly height: number;
  /**
   * Whether this person may be shot at all.
   *
   * The child rule from `docs/GAME_VISION.md` lives here as well as in the NPC
   * catalogue, on purpose: two independent refusals, so a catalogue mistake
   * cannot become a targetable child. `ballistics.test.ts` asserts a target
   * with `targetable: false` is never returned, whatever the geometry says.
   */
  readonly targetable: boolean;
}

export interface Hit {
  readonly targetId: string;
  readonly distance: number;
  /** World point the projectile met, for the impact effect. */
  readonly at: Vec3Like;
}

export interface TraceResult {
  /** Null when the projectile met a wall or nothing at all. */
  readonly hit: Hit | null;
  /** Where the projectile stopped, whatever it stopped on. */
  readonly end: Vec3Like;
  /** True when a wall stopped it, which is what draws a puff of masonry. */
  readonly struckWorld: boolean;
}

/**
 * A direction drawn from a cone.
 *
 * `u` and `v` are two uniform randoms in [0,1). Taking them as arguments
 * rather than calling a generator keeps this pure and lets a test place a
 * pellet exactly where it wants one.
 *
 * The radius uses `sqrt(u)` rather than `u` so the distribution is even across
 * the *disc* — sampling the radius linearly bunches pellets in the middle and
 * makes a shotgun behave like a rifle at range, which is a subtle and
 * long-lived way to get a weapon's whole character wrong.
 */
export function coneDirection(
  forward: Vec3Like,
  right: Vec3Like,
  up: Vec3Like,
  spread: number,
  u: number,
  v: number,
): Vec3Like {
  if (spread <= 0) return normalise(forward);

  const angle = Math.tan(spread) * Math.sqrt(Math.max(0, Math.min(1, u)));
  const theta = v * Math.PI * 2;
  const ox = Math.cos(theta) * angle;
  const oy = Math.sin(theta) * angle;

  return normalise({
    x: forward.x + right.x * ox + up.x * oy,
    y: forward.y + right.y * ox + up.y * oy,
    z: forward.z + right.z * ox + up.z * oy,
  });
}

/**
 * Trace one projectile.
 *
 * `worldDistance` is how far the caller's raycast found the nearest static
 * surface, or `Infinity` for clear air. A target further away than that is
 * behind a wall and is not hit — which is the whole reason the wall distance
 * is a parameter rather than something this could forget to ask for.
 */
export function traceShot(
  origin: Vec3Like,
  direction: Vec3Like,
  range: number,
  targets: readonly ShotTarget[],
  worldDistance: number,
): TraceResult {
  const dir = normalise(direction);
  const wall = Math.min(range, worldDistance);

  let best: Hit | null = null;

  for (const target of targets) {
    if (!target.targetable) continue;

    const t = closestApproach(origin, dir, target.at);
    if (t <= 0 || t > wall) continue;

    const point = {
      x: origin.x + dir.x * t,
      y: origin.y + dir.y * t,
      z: origin.z + dir.z * t,
    };

    // Horizontal miss distance against the torso radius, and a vertical check
    // against the standing height so a shot at the floor does not clip a
    // person's ankles from twenty metres.
    const dx = point.x - target.at.x;
    const dz = point.z - target.at.z;
    if (dx * dx + dz * dz > target.radius * target.radius) continue;
    if (Math.abs(point.y - target.at.y) > target.height * 0.5) continue;

    if (!best || t < best.distance) {
      best = { targetId: target.id, distance: t, at: point };
    }
  }

  if (best) return { hit: best, end: best.at, struckWorld: false };

  const stop = Math.min(range, worldDistance);
  return {
    hit: null,
    end: { x: origin.x + dir.x * stop, y: origin.y + dir.y * stop, z: origin.z + dir.z * stop },
    struckWorld: worldDistance <= range,
  };
}

/** Distance along `dir` at which the ray passes closest to `point`. */
function closestApproach(origin: Vec3Like, dir: Vec3Like, point: Vec3Like): number {
  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const pz = point.z - origin.z;
  return px * dir.x + py * dir.y + pz * dir.z;
}

function normalise(v: Vec3Like): Vec3Like {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ---------------------------------------------------------------------------
// Aim assist
// ---------------------------------------------------------------------------

/**
 * Nudge the aim toward the nearest target inside a small cone.
 *
 * An accessibility option, off by default and scaled by a strength the player
 * chooses. It moves the *direction*, never the outcome: a shot that would have
 * missed by a wide margin still misses, and nothing is ever hit that the cone
 * did not already contain. That distinction is what keeps it an assist rather
 * than a cheat, and it is why `strength` multiplies an angle rather than
 * snapping to a target.
 */
export function assistDirection(
  origin: Vec3Like,
  direction: Vec3Like,
  targets: readonly ShotTarget[],
  opts: { readonly coneRadians: number; readonly strength: number; readonly range: number },
): Vec3Like {
  const dir = normalise(direction);
  if (opts.strength <= 0 || opts.coneRadians <= 0) return dir;

  let bestDot = Math.cos(opts.coneRadians);
  let bestDir: Vec3Like | null = null;

  for (const target of targets) {
    if (!target.targetable) continue;
    const to = {
      x: target.at.x - origin.x,
      y: target.at.y - origin.y,
      z: target.at.z - origin.z,
    };
    const dist = Math.hypot(to.x, to.y, to.z);
    if (dist < 1e-3 || dist > opts.range) continue;

    const unit = { x: to.x / dist, y: to.y / dist, z: to.z / dist };
    const dot = unit.x * dir.x + unit.y * dir.y + unit.z * dir.z;
    if (dot > bestDot) {
      bestDot = dot;
      bestDir = unit;
    }
  }

  if (!bestDir) return dir;
  const k = Math.max(0, Math.min(1, opts.strength));
  return normalise({
    x: dir.x + (bestDir.x - dir.x) * k,
    y: dir.y + (bestDir.y - dir.y) * k,
    z: dir.z + (bestDir.z - dir.z) * k,
  });
}
