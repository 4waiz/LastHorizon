import type { LaneNode as ManifestLane, ZoneManifest } from '../world/zones/Manifest';

/**
 * The road network as traffic sees it.
 *
 * Pedestrians use the navmesh; vehicles use this. They are separate on purpose:
 * a car does not want a shortest path across a plaza, it wants to stay in a
 * lane, and expressing "stay in a lane" as a navmesh constraint is far more
 * work than expressing a lane as a polyline.
 *
 * A zone supplies *centrelines* — the axis of a carriageway. This turns each
 * one into two directed lanes, one per direction, offset to the driver's right.
 * The offset is the whole reason a car looks like it is driving rather than
 * gliding along a painted line.
 *
 * Pure. No Three.js, no side effects, no clock. The village's curved road and
 * the city's straight grid both arrive here as point lists, so both are tested
 * the same way.
 */

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

export interface Point3 extends Point2 {
  readonly y: number;
}

export interface Centreline {
  readonly id: string;
  /** Ordered, at least two points, in world space. */
  readonly points: readonly Point3[];
  readonly speedLimit: number;
}

export interface Lane {
  readonly id: string;
  readonly centrelineId: string;
  /** +1 follows the centreline's own order, -1 runs against it. */
  readonly direction: 1 | -1;
  readonly points: readonly Point3[];
  readonly speedLimit: number;
  readonly length: number;
  /** Cumulative distance at each point; `lengths[i]` is the distance to `points[i]`. */
  readonly lengths: readonly number[];
  /** Lane ids reachable from this lane's end. */
  next: string[];
}

export interface Intersection {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** How far out an approaching vehicle starts caring. */
  readonly radius: number;
  /** Centreline id with priority. The other has to give way. */
  readonly majorCentreline: string;
  readonly minorCentreline: string;
  /**
   * Which axis the lights favour first. Derived from the centreline ids so it
   * is the same on every machine and in every run.
   */
  readonly phaseOffset: number;
}

export interface LaneGraph {
  readonly lanes: readonly Lane[];
  readonly intersections: readonly Intersection[];
  laneById(id: string): Lane | null;
}

/** Half the carriageway a lane sits from the centre: ROAD_HALF 5 m, split. */
export const LANE_OFFSET = 2.5;
/** Lane ends this close are treated as joined. */
export const LANE_JOIN_RADIUS = 8;
/** Approach distance an intersection controls. */
export const INTERSECTION_RADIUS = 11;

/**
 * Right of travel, in a right-handed system with +Y up.
 *
 * For a heading (dx, dz) the driver's right is (-dz, dx). Worth writing down
 * because the intuitive answer is (dz, -dx), and getting it backwards puts the
 * whole city's traffic on the wrong side of the road in a way that looks
 * plausible until two cars meet.
 */
export function rightOf(dx: number, dz: number): Point2 {
  const len = Math.hypot(dx, dz) || 1;
  return { x: -dz / len, z: dx / len };
}

function offsetPolyline(points: readonly Point3[], offset: number): Point3[] {
  const out: Point3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const r = rightOf(b.x - a.x, b.z - a.z);
    out.push({
      x: points[i].x + r.x * offset,
      y: points[i].y,
      z: points[i].z + r.z * offset,
    });
  }
  return out;
}

function cumulative(points: readonly Point3[]): { lengths: number[]; total: number } {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    lengths.push(total);
  }
  return { lengths, total };
}

/**
 * Two directed lanes per centreline, plus intersections where they cross.
 *
 * Lanes shorter than 6 m are dropped. They come from a centreline stub that
 * exists to describe a junction rather than a road, and a lane a car cannot
 * fit on produces a vehicle that spawns and instantly needs a successor.
 */
export function buildLaneGraph(
  centrelines: readonly Centreline[],
  offset = LANE_OFFSET,
): LaneGraph {
  const lanes: Lane[] = [];

  for (const c of centrelines) {
    if (c.points.length < 2) continue;

    const forwardPts = offsetPolyline(c.points, offset);
    const reversed = [...c.points].reverse();
    const backwardPts = offsetPolyline(reversed, offset);

    for (const [dir, pts] of [
      [1, forwardPts],
      [-1, backwardPts],
    ] as const) {
      const { lengths, total } = cumulative(pts);
      if (total < 6) continue;
      lanes.push({
        id: `${c.id}#${dir > 0 ? 'f' : 'b'}`,
        centrelineId: c.id,
        direction: dir,
        points: pts,
        speedLimit: c.speedLimit,
        length: total,
        lengths,
        next: [],
      });
    }
  }

  // Join lane ends to lane starts. A lane never links back to its own opposite
  // direction: that is a U-turn on the spot, and it looks exactly as odd as it
  // sounds.
  for (const lane of lanes) {
    const end = lane.points[lane.points.length - 1];
    for (const other of lanes) {
      if (other.id === lane.id) continue;
      if (other.centrelineId === lane.centrelineId && other.direction !== lane.direction) continue;
      const start = other.points[0];
      if (Math.hypot(end.x - start.x, end.z - start.z) <= LANE_JOIN_RADIUS) {
        lane.next.push(other.id);
      }
    }
    lane.next.sort();
  }

  const intersections = findIntersections(centrelines);
  const byId = new Map(lanes.map((l) => [l.id, l]));

  return {
    lanes,
    intersections,
    laneById: (id) => byId.get(id) ?? null,
  };
}

/**
 * Where two centrelines cross.
 *
 * Segment-versus-segment, every pair, which is O(n^2) in segments and entirely
 * fine: a district has four centrelines of a handful of points each, and this
 * runs once when the zone loads.
 */
export function findIntersections(centrelines: readonly Centreline[]): Intersection[] {
  const out: Intersection[] = [];

  for (let i = 0; i < centrelines.length; i++) {
    for (let j = i + 1; j < centrelines.length; j++) {
      const a = centrelines[i];
      const b = centrelines[j];
      for (let s = 0; s < a.points.length - 1; s++) {
        for (let t = 0; t < b.points.length - 1; t++) {
          const hit = segmentCross(a.points[s], a.points[s + 1], b.points[t], b.points[t + 1]);
          if (!hit) continue;

          // Two segments of the same pair of roads can cross more than once
          // where a road curves back; one junction is enough.
          if (out.some((o) => Math.hypot(o.x - hit.x, o.z - hit.z) < INTERSECTION_RADIUS)) continue;

          // Priority by speed limit, ties broken by id so it is deterministic
          // rather than dependent on declaration order.
          const aMajor =
            a.speedLimit > b.speedLimit || (a.speedLimit === b.speedLimit && a.id < b.id);
          out.push({
            id: `x:${a.id}:${b.id}:${out.length}`,
            x: hit.x,
            z: hit.z,
            radius: INTERSECTION_RADIUS,
            majorCentreline: aMajor ? a.id : b.id,
            minorCentreline: aMajor ? b.id : a.id,
            phaseOffset: stableHash(`${a.id}|${b.id}`) % 2,
          });
        }
      }
    }
  }

  return out;
}

function segmentCross(p1: Point2, p2: Point2, p3: Point2, p4: Point2): Point2 | null {
  const d1x = p2.x - p1.x, d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x, d2z = p4.z - p3.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-9) return null;

  const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1z - (p3.z - p1.z) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + d1x * t, z: p1.z + d1z * t };
}

function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface LanePose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Heading in radians, glTF convention: atan2(dir.x, dir.z). */
  readonly heading: number;
}

/** Position and heading at `distance` along a lane. Clamps at both ends. */
export function sampleLane(lane: Lane, distance: number): LanePose {
  const d = Math.max(0, Math.min(distance, lane.length));
  let i = 1;
  while (i < lane.lengths.length - 1 && lane.lengths[i] < d) i++;

  const a = lane.points[i - 1];
  const b = lane.points[i];
  const span = lane.lengths[i] - lane.lengths[i - 1];
  const t = span > 1e-6 ? (d - lane.lengths[i - 1]) / span : 0;

  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

/**
 * The intersection a vehicle is approaching on this lane, and how far ahead.
 *
 * Null when there is nothing in the next `lookahead` metres, which is the
 * common case and the one worth being cheap about.
 */
export function nextIntersection(
  lane: Lane,
  distance: number,
  intersections: readonly Intersection[],
  lookahead = 26,
): { intersection: Intersection; ahead: number } | null {
  let best: { intersection: Intersection; ahead: number } | null = null;

  for (const x of intersections) {
    const at = projectOntoLane(lane, x);
    if (at.distanceOff > x.radius) continue;

    const ahead = at.along - distance;
    if (ahead < -2 || ahead > lookahead) continue;
    if (!best || ahead < best.ahead) best = { intersection: x, ahead };
  }

  return best;
}

/**
 * Nearest point on a lane to `p`, as a distance along it.
 *
 * Projects onto each **segment**, not onto the vertices. Checking vertices
 * alone was the first version and it is wrong for exactly the case that
 * matters: a district's main road is described by two points 200 m apart, so a
 * junction halfway along is 100 m from the nearest vertex and every approaching
 * car sails through it.
 */
export function projectOntoLane(lane: Lane, p: Point2): { along: number; distanceOff: number } {
  let bestOff = Infinity;
  let bestAlong = 0;

  for (let i = 1; i < lane.points.length; i++) {
    const a = lane.points[i - 1];
    const b = lane.points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-9) continue;

    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const off = Math.hypot(p.x - cx, p.z - cz);
    if (off < bestOff) {
      bestOff = off;
      bestAlong = lane.lengths[i - 1] + Math.sqrt(lenSq) * t;
    }
  }

  return { along: bestAlong, distanceOff: bestOff };
}

/**
 * Which way an intersection's lights are showing, from world time alone.
 *
 * Derived rather than stateful: no timers to save, no drift between the light
 * a test sees and the light a player sees, and a reloaded save finds the
 * junction exactly as it left it.
 */
/**
 * Seconds each axis holds green.
 *
 * Shorter than the watchdog's 8 s barge threshold would be ideal and is not
 * possible — a 6 s green is a junction nobody gets through. Instead the
 * watchdog was taught to recognise a red light as a legitimate reason to be
 * stopped; see `TrafficSystem.step`. This was found by measurement: the first
 * version used 24 s and every car that stopped at a red was barged through it.
 */
export const LIGHT_PERIOD_SECONDS = 14;

export function lightIsGreen(
  intersection: Intersection,
  centrelineId: string,
  elapsedSeconds: number,
): boolean {
  const phase = Math.floor(elapsedSeconds / LIGHT_PERIOD_SECONDS + intersection.phaseOffset) % 2;
  const majorGreen = phase === 0;
  return centrelineId === intersection.majorCentreline ? majorGreen : !majorGreen;
}

// ---------------------------------------------------------------------------
// Centrelines from zone data
// ---------------------------------------------------------------------------

/**
 * Walk a manifest's lane-node graph into maximal chains.
 *
 * The manifest describes a district's roads as a sparse directed graph of
 * six-or-so nodes, which is the right shape for authoring and the wrong shape
 * for driving. A chain runs from any node that is not a plain mid-chain node
 * and continues while the path stays unambiguous — one way out, one way in.
 * Branches therefore start new chains, which is what turns "main road with a
 * side street" into two centrelines that cross.
 */
export function centrelinesFromManifest(
  zone: ZoneManifest,
  heightAt: (x: number, z: number) => number,
): Centreline[] {
  const nodes = new Map<string, ManifestLane>(zone.lanes.map((l) => [l.id, l]));
  const inDegree = new Map<string, number>();
  for (const l of zone.lanes) inDegree.set(l.id, inDegree.get(l.id) ?? 0);
  for (const l of zone.lanes) {
    for (const n of l.next) inDegree.set(n, (inDegree.get(n) ?? 0) + 1);
  }

  const chains: Centreline[] = [];
  const startedFrom = new Set<string>();

  const walk = (startId: string, viaId: string): void => {
    const key = `${startId}->${viaId}`;
    if (startedFrom.has(key)) return;
    startedFrom.add(key);

    const points: ManifestLane[] = [nodes.get(startId)!];
    let current = nodes.get(viaId);
    let limit = zone.lanes.length + 1;

    while (current && limit-- > 0) {
      points.push(current);
      if (current.next.length !== 1) break;
      const nextId = current.next[0];
      if ((inDegree.get(nextId) ?? 0) !== 1) break;
      current = nodes.get(nextId);
    }

    if (points.length < 2) return;
    chains.push({
      id: `${zone.id}:${points[0].id}->${points[points.length - 1].id}`,
      points: points.map((p) => ({ x: p.x, y: heightAt(p.x, p.z), z: p.z })),
      speedLimit: Math.min(...points.map((p) => p.speedLimit)),
    });
  };

  for (const l of zone.lanes) {
    const isRoot = (inDegree.get(l.id) ?? 0) === 0;
    const branches = l.next.length > 1;
    if (!isRoot && !branches) continue;
    for (const n of l.next) walk(l.id, n);
  }

  return chains;
}

/**
 * Centrelines from an already-built polyline, thinned.
 *
 * The village road is a 260-point spline. Every point is worth having for the
 * tarmac mesh and none of it is worth having for a lane graph, where a car
 * interpolating between points 40 cm apart gains nothing and costs a segment
 * search on every frame.
 */
export function centrelineFromPolyline(
  id: string,
  points: readonly Point3[],
  speedLimit: number,
  step = 8,
): Centreline | null {
  if (points.length < 2) return null;
  const thinned: Point3[] = [];
  for (let i = 0; i < points.length; i += step) thinned.push(points[i]);
  const last = points[points.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  if (thinned.length < 2) return null;
  return { id, points: thinned, speedLimit };
}
