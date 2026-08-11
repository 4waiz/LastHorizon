import type { ChunkManifest, ZoneManifest } from './Manifest';
import { chunkKey } from './Manifest';

/**
 * Decides which chunks should be resident, and drives their lifecycle.
 *
 * The decision logic is pure and separated from the loading itself: the
 * streamer is given `load` and `unload` callbacks, so the hysteresis and
 * ordering rules can be unit-tested without a renderer.
 *
 * **Hysteresis is the whole point.** A player standing exactly on a chunk
 * boundary sits at the load-radius edge; without a dead band, that chunk
 * loads and unloads on alternating frames, which is the single most reliable
 * way to produce a stutter and a memory sawtooth. A chunk must therefore fall
 * `unloadHysteresis` metres *beyond* the load radius before it is released.
 */

export type ChunkState = 'loading' | 'resident' | 'unloading';

export interface ChunkHandle {
  readonly manifest: ChunkManifest;
  state: ChunkState;
}

export interface ChunkStreamerCallbacks {
  /** Bring a chunk in. May be async; the streamer tracks the pending state. */
  load(chunk: ChunkManifest): Promise<void> | void;
  /**
   * Release a chunk. Must dispose everything the chunk owns — geometry,
   * materials, textures, physics bodies, navmesh tiles, audio emitters,
   * event subscriptions — so an unloaded chunk contributes nothing.
   */
  unload(chunk: ChunkManifest): Promise<void> | void;
}

export interface StreamDelta {
  readonly toLoad: readonly ChunkManifest[];
  readonly toUnload: readonly ChunkManifest[];
}

/** Squared distance from a point to a chunk's AABB, on the XZ plane. */
export function distanceToChunk(chunk: ChunkManifest, x: number, z: number): number {
  const { minX, minZ, maxX, maxZ } = chunk.bounds;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return Math.hypot(dx, dz);
}

/**
 * How high you can be before streaming stops trying to keep up.
 *
 * The brief for Phase 10 is explicit: *"Aircraft should not force all world
 * chunks to load."* Left alone it would. The aeroplane cruises at 34 m/s, a
 * chunk is 48 m, and two rings of hysteresis is about four seconds of level
 * flight — so crossing a district at altitude means loading and disposing its
 * entire chunk set, at speed, for scenery the player is looking at from 300 m
 * and cannot land on without slowing down first.
 *
 * So the load radius fades with height instead. Below `groundCeiling` nothing
 * changes — a low pass down the runway is still a low pass. Above
 * `aerialFloor` a single ring stays under the aeroplane, and the district's
 * aerial proxy carries the rest of the horizon: coarse blocks, always
 * resident, built once. That is the "distant low-detail representation" the
 * brief asks for.
 *
 * One ring rather than zero deliberately. Zero would mean an aeroplane
 * descending through the floor has nothing beneath it for however long a
 * chunk takes to build, and the first thing it would meet is the ground.
 */
export interface AerialPolicy {
  /** AGL below which streaming behaves exactly as it always has, in metres. */
  readonly groundCeiling: number;
  /** AGL at and above which only `minRings` are kept. */
  readonly aerialFloor: number;
  /** Rings held under the aeroplane at `aerialFloor` and above. */
  readonly minRings: number;
}

export const AERIAL_POLICY: AerialPolicy = {
  groundCeiling: 45,
  aerialFloor: 160,
  minRings: 1,
};

/**
 * The load radius, in rings, for a viewer this high above the ground.
 *
 * Linear between the two heights. Fractional rings are the point: a hard step
 * from two rings to one at a single altitude is a stutter every time somebody
 * flies level at exactly that height, which is what a climb-out does.
 */
export function ringsAt(
  zone: ZoneManifest,
  altitude: number,
  policy: AerialPolicy = AERIAL_POLICY,
): number {
  const agl = Math.max(0, altitude);
  if (agl <= policy.groundCeiling) return zone.loadRadius;
  if (agl >= policy.aerialFloor) return Math.min(zone.loadRadius, policy.minRings);

  const span = policy.aerialFloor - policy.groundCeiling;
  const t = (agl - policy.groundCeiling) / span;
  const floor = Math.min(zone.loadRadius, policy.minRings);
  return zone.loadRadius + (floor - zone.loadRadius) * t;
}

/**
 * Which chunks should be resident for a viewer at (x, z), `altitude` above the
 * ground?
 *
 * `resident` is the currently-loaded set; passing it in is what makes the
 * result hysteretic rather than a pure function of position. A chunk already
 * resident is kept until it exceeds `loadRadius + unloadHysteresis`.
 *
 * `altitude` defaults to 0, so every caller that walks stays unchanged.
 */
export function computeDelta(
  zone: ZoneManifest,
  x: number,
  z: number,
  resident: ReadonlySet<string>,
  altitude = 0,
  policy: AerialPolicy = AERIAL_POLICY,
): StreamDelta {
  if (zone.kind !== 'streamed') return { toLoad: [], toUnload: [] };

  const loadDistance = ringsAt(zone, altitude, policy) * zone.chunkSize;
  const keepDistance = loadDistance + zone.unloadHysteresis;

  const toLoad: ChunkManifest[] = [];
  const toUnload: ChunkManifest[] = [];

  for (const chunk of zone.chunks) {
    const d = distanceToChunk(chunk, x, z);
    const isResident = resident.has(chunk.id);

    if (!isResident && d <= loadDistance) toLoad.push(chunk);
    else if (isResident && d > keepDistance) toUnload.push(chunk);
  }

  // Nearest first, then by coord, so load order is deterministic across runs
  // and across machines — a requirement for reproducible tests.
  toLoad.sort((a, b) => {
    const da = distanceToChunk(a, x, z);
    const db = distanceToChunk(b, x, z);
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  toUnload.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { toLoad, toUnload };
}

export class ChunkStreamer {
  private readonly handles = new Map<string, ChunkHandle>();
  private zone: ZoneManifest | null = null;

  constructor(private readonly cb: ChunkStreamerCallbacks) {}

  setZone(zone: ZoneManifest | null): void {
    this.zone = zone;
  }

  get activeZone(): ZoneManifest | null {
    return this.zone;
  }

  /** Ids of chunks currently resident or on their way in. */
  get residentIds(): ReadonlySet<string> {
    const s = new Set<string>();
    for (const [id, h] of this.handles) if (h.state !== 'unloading') s.add(id);
    return s;
  }

  get residentCount(): number {
    return this.residentIds.size;
  }

  stateOf(chunkId: string): ChunkState | null {
    return this.handles.get(chunkId)?.state ?? null;
  }

  /**
   * Bring the resident set in line with the viewer position. Safe to call
   * every frame: work is only issued for chunks that actually cross a
   * threshold.
   *
   * `altitude` is metres above the ground and defaults to 0. See
   * `AERIAL_POLICY` for what height does to the load radius.
   */
  async update(x: number, z: number, altitude = 0): Promise<StreamDelta> {
    if (!this.zone) return { toLoad: [], toUnload: [] };

    const delta = computeDelta(this.zone, x, z, this.residentIds, altitude);

    for (const chunk of delta.toLoad) {
      // Reserve the slot before awaiting, so a second update() in the same
      // tick cannot start the same load twice.
      this.handles.set(chunk.id, { manifest: chunk, state: 'loading' });
    }
    for (const chunk of delta.toUnload) {
      const h = this.handles.get(chunk.id);
      if (h) h.state = 'unloading';
    }

    await Promise.all([
      ...delta.toLoad.map(async (chunk) => {
        try {
          await this.cb.load(chunk);
          const h = this.handles.get(chunk.id);
          if (h && h.state === 'loading') h.state = 'resident';
        } catch (err) {
          // A chunk that failed to load must not be left claiming a slot.
          this.handles.delete(chunk.id);
          console.warn(`[LastHorizon] chunk ${chunk.id} failed to load`, err);
        }
      }),
      ...delta.toUnload.map(async (chunk) => {
        try {
          await this.cb.unload(chunk);
        } catch (err) {
          console.warn(`[LastHorizon] chunk ${chunk.id} failed to unload cleanly`, err);
        } finally {
          this.handles.delete(chunk.id);
        }
      }),
    ]);

    return delta;
  }

  /** Release every resident chunk. Used on zone exit and on dispose. */
  async unloadAll(): Promise<void> {
    const all = [...this.handles.values()].map((h) => h.manifest);
    for (const h of this.handles.values()) h.state = 'unloading';
    await Promise.all(
      all.map(async (chunk) => {
        try {
          await this.cb.unload(chunk);
        } catch (err) {
          console.warn(`[LastHorizon] chunk ${chunk.id} failed to unload cleanly`, err);
        }
      }),
    );
    this.handles.clear();
  }

  /** Debug readout: which chunk coords are resident, in deterministic order. */
  debugResident(): string[] {
    return [...this.handles.values()]
      .filter((h) => h.state !== 'unloading')
      .map((h) => chunkKey(h.manifest.coord))
      .sort();
  }
}
