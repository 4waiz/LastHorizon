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
 * Which chunks should be resident for a viewer at (x, z)?
 *
 * `resident` is the currently-loaded set; passing it in is what makes the
 * result hysteretic rather than a pure function of position. A chunk already
 * resident is kept until it exceeds `loadRadius + unloadHysteresis`.
 */
export function computeDelta(
  zone: ZoneManifest,
  x: number,
  z: number,
  resident: ReadonlySet<string>,
): StreamDelta {
  if (zone.kind !== 'streamed') return { toLoad: [], toUnload: [] };

  const loadDistance = zone.loadRadius * zone.chunkSize;
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
   */
  async update(x: number, z: number): Promise<StreamDelta> {
    if (!this.zone) return { toLoad: [], toUnload: [] };

    const delta = computeDelta(this.zone, x, z, this.residentIds);

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
