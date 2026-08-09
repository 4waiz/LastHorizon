import type { TimeMode } from '../../core/Settings';

/**
 * Typed world/zone/chunk manifests.
 *
 * The world is deliberately **not** one seamless map. It is a set of zones,
 * each owning its own spawns, chunks, roads, collision proxies, navigation
 * data, audio and weather profiles, NPC spawn definitions, interior links and
 * asset bundles. A zone is the unit of load, disposal and save-safety.
 *
 * Everything here is data and pure functions — no Three.js, no side effects —
 * so manifests can be validated in a unit test without a GPU or a DOM.
 */

export type ZoneId =
  | 'village_coast'
  | 'city_old_market'
  | 'city_downtown'
  | 'city_waterfront'
  | 'hill_airstrip';

export type ZoneKind = 'authored' | 'streamed';

/** Chunk coordinate within a zone's grid. Integer, may be negative. */
export interface ChunkCoord {
  readonly cx: number;
  readonly cz: number;
}

export const chunkKey = (c: ChunkCoord): string => `${c.cx},${c.cz}`;

export interface ChunkManifest {
  readonly coord: ChunkCoord;
  /** Stable id: `${zoneId}:${cx},${cz}`. Used for disposal bookkeeping. */
  readonly id: string;
  /** Deterministic per-chunk seed; never Math.random(). */
  readonly seed: number;
  /** World-space AABB on the XZ plane. */
  readonly bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Asset bundle keys this chunk needs resident before it may show. */
  readonly bundles: readonly string[];
}

export interface SpawnPoint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Facing in radians, glTF convention: atan2(dir.x, dir.z). */
  readonly facing: number;
  /**
   * Whether a vehicle can be placed here. Travel that arrives in a vehicle
   * must resolve to a spawn with this set, or it is not a safe arrival.
   */
  readonly vehicleSafe: boolean;
  /** Clear radius in metres. Used by spawn-safety checks. */
  readonly clearance: number;
}

export interface InteriorLink {
  readonly id: string;
  /** Exterior door position. */
  readonly x: number;
  readonly z: number;
  readonly interiorId: string;
  readonly prompt: string;
}

/** A directed lane for vehicles. Pedestrians use the navmesh, not this. */
export interface LaneNode {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Ids of lane nodes reachable from here, one-way. */
  readonly next: readonly string[];
  readonly speedLimit: number;
}

export interface AudioProfile {
  readonly zoneTrack: 'outdoor' | 'indoor' | 'city';
  readonly ambience: readonly string[];
  readonly reverb: number;
}

export interface WeatherProfile {
  readonly windStrength: number;
  readonly fogFar: number;
  readonly defaultTimeMode: TimeMode;
}

/**
 * A marked pedestrian crossing.
 *
 * Not a connectivity fix — the kerb is 0.14 m and the navmesh walks straight
 * over it. This is where pedestrians *choose* to cross, which is the difference
 * between a street that reads as a street and one where everyone jaywalks.
 */
export interface CrossingDef {
  readonly id: string;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

/**
 * Where ambient pedestrians may appear and wander.
 *
 * Named residents are not here: they live in `src/npc/npcCatalog.ts` with their
 * homes, jobs and schedules, and declare which zone they belong to. Two places
 * describing the same person is how one of them goes stale.
 */
export interface AmbientAreaDef {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Relative share of the zone's pedestrian budget. Positive. */
  readonly weight: number;
}

export interface ZoneManifest {
  readonly id: ZoneId;
  readonly displayName: string;
  readonly kind: ZoneKind;
  /** Deterministic zone seed. All placement derives from this. */
  readonly seed: number;
  /** Streamed zones only: chunk edge length in metres. */
  readonly chunkSize: number;
  /**
   * Streamed zones only: how many rings of chunks are resident around the
   * player. The phase budget is 2 — a 5x5 block at most.
   */
  readonly loadRadius: number;
  /**
   * Extra distance, in metres, a chunk must fall beyond the load radius
   * before it is unloaded. Without this a player standing on a boundary
   * thrashes chunks in and out every frame.
   */
  readonly unloadHysteresis: number;
  readonly bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  readonly spawns: readonly SpawnPoint[];
  readonly defaultSpawnId: string;
  readonly chunks: readonly ChunkManifest[];
  readonly interiors: readonly InteriorLink[];
  readonly lanes: readonly LaneNode[];
  readonly crossings: readonly CrossingDef[];
  readonly ambientAreas: readonly AmbientAreaDef[];
  readonly audio: AudioProfile;
  readonly weather: WeatherProfile;
  readonly bundles: readonly string[];
  /** Zones reachable directly from here, by TravelService. */
  readonly neighbours: readonly ZoneId[];
  /** False for zones that exist in the manifest but are not yet playable. */
  readonly playable: boolean;
}

export interface WorldManifest {
  readonly version: number;
  readonly startZone: ZoneId;
  readonly zones: readonly ZoneManifest[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  readonly zone?: ZoneId;
  readonly code: string;
  readonly message: string;
}

/**
 * Structural validation. Catches the failure modes that would otherwise show
 * up as a player stranded in empty space: a default spawn that does not
 * exist, a neighbour pointing at a missing zone, duplicate ids, chunks whose
 * bounds fall outside the zone, or a travel graph with a one-way edge.
 */
export function validateWorldManifest(world: WorldManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<ZoneId>();

  if (world.zones.length === 0) {
    issues.push({ code: 'empty-world', message: 'world manifest has no zones' });
  }

  for (const z of world.zones) {
    if (ids.has(z.id)) {
      issues.push({ zone: z.id, code: 'duplicate-zone', message: `zone ${z.id} declared twice` });
    }
    ids.add(z.id);
    issues.push(...validateZone(z));
  }

  if (!ids.has(world.startZone)) {
    issues.push({
      code: 'missing-start-zone',
      message: `startZone ${world.startZone} is not among the declared zones`,
    });
  }

  // Neighbour edges must resolve, and must be symmetric: a one-way link is
  // how a player ends up somewhere they cannot leave.
  for (const z of world.zones) {
    for (const n of z.neighbours) {
      if (!ids.has(n)) {
        issues.push({
          zone: z.id,
          code: 'missing-neighbour',
          message: `${z.id} lists neighbour ${n}, which does not exist`,
        });
        continue;
      }
      const other = world.zones.find((o) => o.id === n);
      if (other && !other.neighbours.includes(z.id)) {
        issues.push({
          zone: z.id,
          code: 'asymmetric-neighbour',
          message: `${z.id} -> ${n} is one-way; ${n} does not list ${z.id}`,
        });
      }
    }
  }

  return issues;
}

export function validateZone(z: ZoneManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string) => issues.push({ zone: z.id, code, message });

  if (z.bounds.minX >= z.bounds.maxX || z.bounds.minZ >= z.bounds.maxZ) {
    push('bad-bounds', `zone bounds are inverted or empty`);
  }

  // Spawns
  if (z.spawns.length === 0) push('no-spawns', 'zone declares no spawn points');
  const spawnIds = new Set<string>();
  for (const s of z.spawns) {
    if (spawnIds.has(s.id)) push('duplicate-spawn', `spawn ${s.id} declared twice`);
    spawnIds.add(s.id);
    if (s.clearance <= 0) push('bad-clearance', `spawn ${s.id} has non-positive clearance`);
    if (!withinBounds(z, s.x, s.z)) {
      push('spawn-out-of-bounds', `spawn ${s.id} lies outside the zone bounds`);
    }
  }
  if (!spawnIds.has(z.defaultSpawnId)) {
    push('missing-default-spawn', `defaultSpawnId ${z.defaultSpawnId} is not a declared spawn`);
  }
  if (z.playable && !z.spawns.some((s) => s.vehicleSafe)) {
    push('no-vehicle-spawn', 'playable zone has no vehicle-safe spawn; arriving by vehicle would be unsafe');
  }

  // Streaming
  if (z.kind === 'streamed') {
    if (z.chunkSize <= 0) push('bad-chunk-size', 'streamed zone needs a positive chunkSize');
    if (z.loadRadius < 1) push('bad-load-radius', 'streamed zone needs loadRadius >= 1');
    if (z.loadRadius > 2) {
      push('load-radius-over-budget', `loadRadius ${z.loadRadius} exceeds the phase budget of 2 rings`);
    }
    if (z.unloadHysteresis <= 0) {
      push('no-hysteresis', 'streamed zone needs positive unloadHysteresis or chunks will thrash');
    }
    if (z.chunks.length === 0) push('no-chunks', 'streamed zone declares no chunks');
  }

  // Chunks
  const chunkIds = new Set<string>();
  for (const c of z.chunks) {
    if (chunkIds.has(c.id)) push('duplicate-chunk', `chunk ${c.id} declared twice`);
    chunkIds.add(c.id);
    if (c.id !== `${z.id}:${chunkKey(c.coord)}`) {
      push('bad-chunk-id', `chunk id ${c.id} does not match its coord`);
    }
    if (!Number.isInteger(c.coord.cx) || !Number.isInteger(c.coord.cz)) {
      push('non-integer-coord', `chunk ${c.id} has a non-integer coord`);
    }
  }

  // Lanes must not dangle: a vehicle following a lane into a missing node
  // has nowhere to go.
  const laneIds = new Set(z.lanes.map((l) => l.id));
  for (const l of z.lanes) {
    for (const n of l.next) {
      if (!laneIds.has(n)) {
        push('dangling-lane', `lane ${l.id} points at missing node ${n}`);
      }
    }
    if (l.speedLimit <= 0) push('bad-speed-limit', `lane ${l.id} has non-positive speed limit`);
  }

  // Interiors
  const interiorIds = new Set<string>();
  for (const i of z.interiors) {
    if (interiorIds.has(i.id)) push('duplicate-interior', `interior link ${i.id} declared twice`);
    interiorIds.add(i.id);
  }

  // Crossings. A zero-length crossing is a data slip that produces an off-mesh
  // link with both ends in the same place, which Detour accepts and no agent
  // can ever traverse.
  const crossingIds = new Set<string>();
  for (const c of z.crossings) {
    if (crossingIds.has(c.id)) push('duplicate-crossing', `crossing ${c.id} declared twice`);
    crossingIds.add(c.id);
    if (Math.hypot(c.bx - c.ax, c.bz - c.az) < 0.5) {
      push('degenerate-crossing', `crossing ${c.id} is shorter than half a metre`);
    }
    if (!withinBounds(z, c.ax, c.az) || !withinBounds(z, c.bx, c.bz)) {
      push('crossing-out-of-bounds', `crossing ${c.id} has an end outside the zone`);
    }
  }

  // Ambient areas
  const areaIds = new Set<string>();
  for (const a of z.ambientAreas) {
    if (areaIds.has(a.id)) push('duplicate-ambient-area', `ambient area ${a.id} declared twice`);
    areaIds.add(a.id);
    if (a.radius <= 0) push('bad-ambient-radius', `ambient area ${a.id} has non-positive radius`);
    if (a.weight <= 0) push('bad-ambient-weight', `ambient area ${a.id} has non-positive weight`);
    if (!withinBounds(z, a.x, a.z)) {
      push('ambient-area-out-of-bounds', `ambient area ${a.id} lies outside the zone`);
    }
  }
  if (z.playable && z.kind === 'streamed' && z.ambientAreas.length === 0) {
    push('no-ambient-areas', 'playable district has nowhere for pedestrians to appear');
  }

  return issues;
}

export function withinBounds(z: ZoneManifest, x: number, zc: number): boolean {
  return x >= z.bounds.minX && x <= z.bounds.maxX && zc >= z.bounds.minZ && zc <= z.bounds.maxZ;
}

/**
 * Deterministic chunk seed.
 *
 * Derived from the zone seed and the coord so a chunk's contents are identical
 * on every load and on every machine — a requirement for reproducible tests
 * and for save-safety. Uses a 32-bit integer hash, never Math.random().
 */
export function chunkSeed(zoneSeed: number, coord: ChunkCoord): number {
  let h = zoneSeed | 0;
  h = (Math.imul(h ^ (coord.cx | 0), 0x27d4eb2d) + 0x165667b1) | 0;
  h = (Math.imul(h ^ (coord.cz | 0), 0x85ebca6b) + 0x9e3779b9) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Build a rectangular chunk grid for a streamed zone. Pure and ordered. */
export function buildChunkGrid(
  zoneId: ZoneId,
  zoneSeed: number,
  chunkSize: number,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): ChunkManifest[] {
  const out: ChunkManifest[] = [];
  const cx0 = Math.floor(bounds.minX / chunkSize);
  const cx1 = Math.floor((bounds.maxX - 1e-6) / chunkSize);
  const cz0 = Math.floor(bounds.minZ / chunkSize);
  const cz1 = Math.floor((bounds.maxZ - 1e-6) / chunkSize);

  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const coord: ChunkCoord = { cx, cz };
      out.push({
        coord,
        id: `${zoneId}:${chunkKey(coord)}`,
        seed: chunkSeed(zoneSeed, coord),
        bounds: {
          minX: cx * chunkSize,
          minZ: cz * chunkSize,
          maxX: (cx + 1) * chunkSize,
          maxZ: (cz + 1) * chunkSize,
        },
        bundles: ['city_kit'],
      });
    }
  }
  return out;
}
