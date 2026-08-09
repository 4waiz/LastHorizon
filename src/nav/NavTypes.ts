import type * as THREE from 'three';
import type { ZoneManifest } from '../world/zones/Manifest';

/**
 * Navigation data and the pure functions that shape it.
 *
 * Deliberately free of `recast-navigation`: that package inlines ~900 kB of
 * WebAssembly, and the initial-load budget has no room for it. Everything here
 * is plain arrays and arithmetic, so the parts worth testing — what geometry
 * feeds the build, where the off-mesh links go, whether a config is sane — are
 * testable without a WASM runtime, and none of it costs a byte at startup.
 *
 * The recast-backed half lives in `Navigation.ts`, which is only ever reached
 * through the dynamic import in `NavService`.
 */

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Bounds2D {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** Triangle soup for the generator, plus the box it should rasterise. */
export interface NavBuildInput {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: Bounds2D;
  /** Vertical extent actually present, so tiles are not taller than needed. */
  readonly minY: number;
  readonly maxY: number;
}

export type OffMeshKind = 'door' | 'crossing' | 'stairs' | 'zone';

export interface OffMeshLink {
  readonly id: string;
  readonly kind: OffMeshKind;
  readonly start: Vec3Like;
  readonly end: Vec3Like;
  /** How close an agent must come to snap onto the link. */
  readonly radius: number;
  readonly bidirectional: boolean;
}

// ---------------------------------------------------------------------------
// Agent and generator configuration
// ---------------------------------------------------------------------------

/**
 * The pedestrian, as Recast sees it.
 *
 * `radius` matches `DEFAULT_MOTOR.radius` (0.30) rather than being picked to
 * look right, because the navmesh and the character motor have to agree about
 * what fits through a gap. A crowd agent that is thinner than the capsule walks
 * confidently into walls; one that is fatter refuses doorways the player can
 * stroll through.
 */
export const NAV_AGENT = {
  radius: 0.3,
  /** Capsule height: 1.34 body + 2 x 0.30 caps. */
  height: 1.94,
  maxSpeed: 1.35,
  maxAcceleration: 8,
  /** Metres ahead an agent looks for neighbours. Three body-widths. */
  collisionQueryRange: 1.8,
  pathOptimizationRange: 12,
  separationWeight: 2,
} as const;

/**
 * Recast configuration, in the units Recast actually wants.
 *
 * The trap here is that only `cs`, `ch` and `walkableSlopeAngle` are in world
 * units. `walkableHeight`, `walkableClimb` and `walkableRadius` are **voxel
 * counts**, so each has to be divided through by the cell size — passing metres
 * gives a navmesh eroded by several metres, which is one way to get an empty
 * one.
 *
 * Phase 2 recorded Recast as broken ("Failed to create Detour navmesh data")
 * and deferred it here. It is not broken; see `docs/PHASE_06_REPORT.md`.
 */
export const NAV_CELL_SIZE = 0.3;
export const NAV_CELL_HEIGHT = 0.2;

export const NAV_CONFIG = {
  cs: NAV_CELL_SIZE,
  ch: NAV_CELL_HEIGHT,
  /** Matches `DEFAULT_MOTOR.maxSlopeDot`, which is cos(50 deg). */
  walkableSlopeAngle: 50,
  /** ceil(1.94 / 0.2) = 10 voxels. */
  walkableHeight: 10,
  /** DEFAULT_MOTOR.stepHeight 0.42 / 0.2 = 2 voxels, so kerbs are steppable. */
  walkableClimb: 2,
  /**
   * One voxel, 0.30 m, not two.
   *
   * Erosion is by agent radius and it is measured from *both* sides, so 2
   * voxels takes 1.2 m out of every gap and closes a 1.2 m doorway completely.
   * At one voxel a standard door still has 0.6 m of centre-line through it.
   */
  walkableRadius: 1,
  maxEdgeLen: 12,
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
  /**
   * 64 voxels, 19.2 m per tile.
   *
   * Measured on village-scale input (85 k triangles, 256 m square): 32 voxels
   * took 414 ms, 64 took 321 ms, and dropping resolution to cs 0.4 only bought
   * another 70 ms while costing doorway fidelity.
   */
  tileSize: 64,
} as const;

// ---------------------------------------------------------------------------
// Geometry extraction
// ---------------------------------------------------------------------------

/** How far above and below the bounds a triangle may sit and still count. */
const VERTICAL_MARGIN = 40;

/**
 * How far above the ground a surface may be and still be somewhere to walk.
 *
 * A flat roof is a walkable slope with unlimited headroom, so Recast is
 * perfectly happy to put navmesh on top of every house — and it did. The first
 * run of this phase had residents pathing onto rooftops, arriving five metres
 * above the terrain, and a stuck-recovery snap finding the roof directly above
 * a blocked destination and teleporting somebody up there.
 *
 * 2.2 m keeps porches, steps, kerbs and low walls, and loses roofs. A boulder
 * shorter than this stays walkable, which is fine — you can stand on a rock.
 */
export const MAX_WALKABLE_ABOVE_GROUND = 2.2;

export interface NavGeometryOptions {
  /**
   * Ground height at a point. When supplied, surfaces more than
   * `MAX_WALKABLE_ABOVE_GROUND` above it are dropped.
   */
  readonly groundAt?: (x: number, z: number) => number;
  readonly maxAboveGround?: number;
}

/**
 * Turn the zone's merged collision proxy into generator input.
 *
 * Three filters earn their place. Triangles outside the zone bounds are
 * dropped, which keeps the interior cell — parked at y = 600 in its own corner
 * of world space — from adding a floating navmesh island 600 m above the
 * village. Triangles too far above the ground are dropped, which is what keeps
 * people off roofs. And degenerate triangles are dropped, because a zero-area
 * triangle rasterises to nothing and only costs time.
 */
export function navInputFromGeometry(
  geometry: THREE.BufferGeometry,
  bounds: Bounds2D,
  options: NavGeometryOptions = {},
): NavBuildInput {
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triCount = index ? index.count / 3 : pos.count / 3;

  const outPos: number[] = [];
  const outIdx: number[] = [];
  /** Source vertex -> compacted vertex, so shared verts stay shared. */
  const remap = new Map<number, number>();
  let minY = Infinity;
  let maxY = -Infinity;

  const vertexAt = (i: number): number | null => {
    const existing = remap.get(i);
    if (existing !== undefined) return existing;
    const n = outPos.length / 3;
    outPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    remap.set(i, n);
    return n;
  };

  const inside = (i: number): boolean => {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  };

  const groundAt = options.groundAt;
  const maxAbove = options.maxAboveGround ?? MAX_WALKABLE_ABOVE_GROUND;

  /**
   * Is every corner of this triangle too high to be a floor?
   *
   * All three, not the centroid: a ramp or a stair that climbs past the
   * threshold at one end is still somewhere to walk for most of its length,
   * and dropping it would cut the navmesh in half at the bottom of the slope.
   */
  const aboveGround = (a: number, b: number, c: number): boolean => {
    if (!groundAt) return false;
    for (const v of [a, b, c]) {
      const x = pos.getX(v);
      const z = pos.getZ(v);
      if (pos.getY(v) - groundAt(x, z) <= maxAbove) return false;
    }
    return true;
  };

  for (let t = 0; t < triCount; t++) {
    const a = index ? index.getX(t * 3) : t * 3;
    const b = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const c = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    // Any vertex inside keeps the triangle: clipping at the boundary would
    // leave a ragged edge exactly where an agent is most likely to be walking.
    if (!inside(a) && !inside(b) && !inside(c)) continue;
    if (isDegenerate(pos, a, b, c)) continue;
    if (aboveGround(a, b, c)) continue;

    const ia = vertexAt(a);
    const ib = vertexAt(b);
    const ic = vertexAt(c);
    if (ia === null || ib === null || ic === null) continue;
    outIdx.push(ia, ib, ic);

    for (const v of [a, b, c]) {
      const y = pos.getY(v);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minY)) {
    minY = 0;
    maxY = 1;
  }

  return {
    positions: new Float32Array(outPos),
    indices: new Uint32Array(outIdx),
    bounds,
    minY: minY - VERTICAL_MARGIN,
    maxY: maxY + VERTICAL_MARGIN,
  };
}

function isDegenerate(
  pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
  c: number,
): boolean {
  const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
  const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
  const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
  if (!Number.isFinite(ax + ay + az + bx + by + bz + cx + cy + cz)) return true;

  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  // Twice the triangle area, squared. 1e-10 is well below anything the proxy
  // meshes produce and well above float noise on a 256 m span.
  return nx * nx + ny * ny + nz * nz < 1e-10;
}

// ---------------------------------------------------------------------------
// Off-mesh links
// ---------------------------------------------------------------------------

/** How far out from a door the street-side end of a door link sits. */
export const DOOR_APPROACH = 2.4;

/**
 * Derive the zone's off-mesh links.
 *
 * Doors are the case that genuinely needs a link: the navmesh is eroded away
 * inside a building footprint, so the doorstep is unreachable and an NPC whose
 * schedule says "go home" has nowhere to path to. The link gives it a
 * destination, and the two ends give the animation something to play between.
 *
 * `heightAt` is injected rather than reached for, so this stays pure and a test
 * can supply a flat ground plane.
 */
export function offMeshLinksForZone(
  zone: ZoneManifest,
  heightAt: (x: number, z: number) => number,
): OffMeshLink[] {
  const links: OffMeshLink[] = [];

  for (const door of zone.interiors) {
    // Step out along whichever axis has more room inside the zone bounds; a
    // door on the north edge should approach from the south.
    const toCentreX = (zone.bounds.minX + zone.bounds.maxX) / 2 - door.x;
    const toCentreZ = (zone.bounds.minZ + zone.bounds.maxZ) / 2 - door.z;
    const len = Math.hypot(toCentreX, toCentreZ) || 1;
    const ax = door.x + (toCentreX / len) * DOOR_APPROACH;
    const az = door.z + (toCentreZ / len) * DOOR_APPROACH;

    links.push({
      id: `door:${door.id}`,
      kind: 'door',
      start: { x: ax, y: heightAt(ax, az), z: az },
      end: { x: door.x, y: heightAt(door.x, door.z), z: door.z },
      radius: 0.9,
      bidirectional: true,
    });
  }

  for (const c of zone.crossings ?? []) {
    links.push({
      id: `crossing:${c.id}`,
      kind: 'crossing',
      start: { x: c.ax, y: heightAt(c.ax, c.az), z: c.az },
      end: { x: c.bx, y: heightAt(c.bx, c.bz), z: c.bz },
      radius: 1.1,
      bidirectional: true,
    });
  }

  return links;
}

/**
 * Nearest crossing to a straight walk, if crossing there is worth the detour.
 *
 * Pedestrians preferring a crossing is a routing preference, not a
 * connectivity problem — the kerb is 0.14 m and Recast happily walks over it —
 * so it is solved here rather than by marking areas in the generator. An NPC
 * whose path would cut across a carriageway is given the crossing as an
 * intermediate waypoint, and only if the detour is small enough that a person
 * would actually make it.
 */
export function preferredCrossing(
  from: Vec3Like,
  to: Vec3Like,
  links: readonly OffMeshLink[],
  maxDetour = 26,
): OffMeshLink | null {
  const direct = Math.hypot(to.x - from.x, to.z - from.z);
  let best: OffMeshLink | null = null;
  let bestCost = Infinity;

  for (const link of links) {
    if (link.kind !== 'crossing') continue;
    // Enter by whichever end is nearer, leave by the other.
    const viaA =
      Math.hypot(link.start.x - from.x, link.start.z - from.z) +
      Math.hypot(to.x - link.end.x, to.z - link.end.z);
    const viaB =
      Math.hypot(link.end.x - from.x, link.end.z - from.z) +
      Math.hypot(to.x - link.start.x, to.z - link.start.z);
    const cost = Math.min(viaA, viaB);
    if (cost < bestCost) {
      bestCost = cost;
      best = link;
    }
  }

  if (!best || bestCost - direct > maxDetour) return null;
  return best;
}
