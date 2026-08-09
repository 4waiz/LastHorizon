/**
 * Which tier of simulation an NPC gets.
 *
 * Three bands, and the boundaries are chosen against what each tier can afford
 * rather than against what looks nice:
 *
 * - **near** — a Detour crowd agent, an animated body, perception, and an
 *   interaction prompt. The expensive one. Sized so the whole visible street
 *   fits and nothing more.
 * - **mid** — a body and coarse point-to-point movement, no crowd agent, no
 *   perception, animation stepped at a fraction of the frame rate. Visible
 *   from across a district, costs a lerp.
 * - **far** — a schedule and a position, nothing rendered. Costs one number
 *   comparison per tick, and only does real work when the schedule turns over.
 *
 * Hysteresis is not decoration. An NPC standing exactly on a boundary would
 * otherwise add and remove a crowd agent every frame, and adding a crowd agent
 * allocates inside WASM.
 */

export type LodBand = 'near' | 'mid' | 'far';

export interface LodRanges {
  readonly near: number;
  readonly mid: number;
  /** Extra metres to travel back out before demotion. */
  readonly hysteresis: number;
}

export const DEFAULT_LOD: LodRanges = {
  near: 34,
  mid: 90,
  hysteresis: 8,
};

/**
 * The band for `distance`, given what the NPC was in last frame.
 *
 * Promotion uses the plain threshold; demotion needs the threshold plus the
 * dead band. Written as "how far out must I be to lose what I have" rather than
 * as two symmetrical comparisons, because the asymmetry is the point.
 */
export function bandFor(distance: number, current: LodBand, ranges: LodRanges = DEFAULT_LOD): LodBand {
  const h = ranges.hysteresis;

  if (current === 'near') {
    if (distance <= ranges.near + h) return 'near';
    return distance <= ranges.mid + h ? 'mid' : 'far';
  }

  if (current === 'mid') {
    if (distance <= ranges.near) return 'near';
    return distance <= ranges.mid + h ? 'mid' : 'far';
  }

  // far
  if (distance <= ranges.near) return 'near';
  return distance <= ranges.mid ? 'mid' : 'far';
}

/**
 * Population caps by quality preset.
 *
 * `named` is not capped by preset: all twenty exist in every preset because the
 * story needs to find them. What scales is how many of them get an expensive
 * tier, and how many ambient pedestrians and drivers exist at all.
 */
export interface PopulationBudget {
  /** Hard cap on simultaneous near-tier NPCs, named and ambient together. */
  readonly maxNear: number;
  readonly maxAmbient: number;
  readonly maxTraffic: number;
  /** Far-tier NPCs examined per far tick. Bounds the worst case. */
  readonly farPerTick: number;
  readonly lod: LodRanges;
}

export const POPULATION_BUDGETS: Record<'low' | 'medium' | 'high', PopulationBudget> = {
  low: {
    maxNear: 10,
    maxAmbient: 6,
    maxTraffic: 3,
    farPerTick: 8,
    lod: { near: 22, mid: 55, hysteresis: 6 },
  },
  medium: {
    maxNear: 18,
    maxAmbient: 14,
    maxTraffic: 6,
    farPerTick: 8,
    lod: DEFAULT_LOD,
  },
  /**
   * `high` is capped by draw calls, not by simulation cost.
   *
   * A body is one draw call and 4,890 triangles — the player's own mesh,
   * merged. Twenty-six of them plus eight cars is +58 calls and +127 k
   * triangles over an unpopulated village, measured. The earlier 24 ambient
   * put the outdoor scene past 480 calls, which is more than the night peak
   * the budget was written around.
   *
   * The real fix is a decimated mid-tier body: at ~1,200 triangles it would
   * give back roughly 96 k of that, and it needs a Blender change to the
   * shared rig. Recorded as a follow-up rather than rushed in here.
   */
  high: {
    maxNear: 22,
    maxAmbient: 18,
    maxTraffic: 8,
    farPerTick: 12,
    lod: { near: 42, mid: 110, hysteresis: 10 },
  },
};

/**
 * Rank candidates for the near tier when more want it than the budget allows.
 *
 * Nearest wins, with named residents given a 6 m head start. A named resident
 * who is one metre further away than a pedestrian is the one the player came to
 * talk to, and dropping them to coarse movement because a stranger was closer
 * is the version of this that feels broken.
 */
export function rankForNear(
  candidates: readonly { id: string; distance: number; named: boolean }[],
  maxNear: number,
): Set<string> {
  const NAMED_BONUS = 6;
  const sorted = [...candidates].sort((a, b) => {
    const da = a.distance - (a.named ? NAMED_BONUS : 0);
    const db = b.distance - (b.named ? NAMED_BONUS : 0);
    if (da !== db) return da - db;
    // Stable on id so the same frame always produces the same set.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return new Set(sorted.slice(0, Math.max(0, maxNear)).map((c) => c.id));
}
