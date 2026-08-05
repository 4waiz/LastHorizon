import { DisposalRegistry } from '../../core/DisposalRegistry';
import type { ChunkManifest, WorldManifest, ZoneId, ZoneManifest } from './Manifest';
import { validateWorldManifest } from './Manifest';
import { ChunkStreamer } from './ChunkStreamer';
import { SpawnRegistry } from './SpawnRegistry';
import { TravelService, type TravelHooks } from './TravelService';

/**
 * Owns which zone is active, what is resident inside it, and the disposal
 * scope that guarantees leaving it gives everything back.
 *
 * The manager deliberately knows nothing about Three.js. A `ZoneBuilder` is
 * injected to do the actual construction, so the lifecycle rules — one active
 * zone, one disposal scope per zone, one nested scope per chunk — can be
 * tested without a renderer, and the same rules apply to whatever the builder
 * happens to create.
 */

export interface ZoneBuilder {
  /** Build the zone's always-resident content. Register everything created. */
  buildZone(zone: ZoneManifest, scope: DisposalRegistry): Promise<void> | void;
  /** Build one streamed chunk. Register everything into the chunk's scope. */
  buildChunk(
    zone: ZoneManifest,
    chunk: ChunkManifest,
    scope: DisposalRegistry,
  ): Promise<void> | void;
}

export interface ZoneDebugState {
  zoneId: ZoneId | null;
  zoneName: string;
  kind: string;
  residentChunks: string[];
  residentCount: number;
  trackedResources: number;
  travelling: boolean;
}

export class ZoneManager {
  readonly spawns: SpawnRegistry;
  readonly travel: TravelService;

  private readonly streamer: ChunkStreamer;
  private active: ZoneManifest | null = null;
  private zoneScope: DisposalRegistry | null = null;
  private readonly chunkScopes = new Map<string, DisposalRegistry>();

  constructor(
    private readonly world: WorldManifest,
    private readonly builder: ZoneBuilder,
    travelHooks?: Partial<TravelHooks>,
  ) {
    const issues = validateWorldManifest(world);
    if (issues.length) {
      // A malformed manifest strands players. Refuse to boot on one.
      const summary = issues.map((i) => `${i.zone ?? 'world'}: ${i.code} — ${i.message}`).join('; ');
      throw new Error(`invalid world manifest: ${summary}`);
    }

    this.spawns = new SpawnRegistry(world);
    this.streamer = new ChunkStreamer({
      load: (chunk) => this.loadChunk(chunk),
      unload: (chunk) => this.unloadChunk(chunk),
    });

    /*
     * `TravelService` prepares the destination before releasing the source, so
     * a failed journey is a no-op. `enter()` refuses to run while another zone
     * is active, because two resident zones would double peak memory and make
     * `active` ambiguous. Both rules are worth having and they conflict.
     *
     * Resolution: the check that actually prevents stranding — resolving a
     * valid spawn in the destination — already runs before either hook. So the
     * source is released inside `prepare`, immediately before building, and
     * `release` becomes a no-op.
     *
     * The residual risk is narrow but real: if `enter()` throws *after*
     * `leave()` has run, the player is left with no active zone. `enter()`
     * disposes its own partial scope, so nothing leaks, but recovery would
     * need a re-entry into the source zone. Not handled yet — see
     * docs/PHASE_02_REPORT.md.
     */
    this.travel = new TravelService(this.spawns, {
      prepare:
        travelHooks?.prepare ??
        (async (id) => {
          await this.leave();
          await this.enter(id);
        }),
      release: travelHooks?.release ?? (async () => { /* done inside prepare */ }),
      ...(travelHooks?.fade ? { fade: travelHooks.fade } : {}),
    });
  }

  get activeZone(): ZoneManifest | null {
    return this.active;
  }

  get activeZoneId(): ZoneId | null {
    return this.active?.id ?? null;
  }

  /** Build a zone and make it active. The previous zone must be left first. */
  async enter(id: ZoneId): Promise<void> {
    const zone = this.spawns.zone(id);
    if (!zone) throw new Error(`unknown zone ${id}`);
    if (this.active && this.active.id !== id) {
      throw new Error(`zone ${this.active.id} is still active; leave it before entering ${id}`);
    }
    if (this.active?.id === id) return;

    const scope = new DisposalRegistry(`zone:${id}`);
    try {
      await this.builder.buildZone(zone, scope);
    } catch (err) {
      // Partial construction still owns resources; release them before
      // rethrowing so a failed entry does not leak.
      scope.dispose();
      throw err;
    }

    this.zoneScope = scope;
    this.active = zone;
    this.streamer.setZone(zone);
  }

  /** Release the active zone and everything resident inside it. */
  async leave(): Promise<void> {
    if (!this.active) return;
    await this.streamer.unloadAll();
    this.streamer.setZone(null);
    // Chunk scopes are children of the zone scope, so this covers them even
    // if a chunk unload was skipped.
    this.zoneScope?.dispose();
    this.chunkScopes.clear();
    this.zoneScope = null;
    this.active = null;
  }

  /** Drive streaming from the viewer position. Safe to call every frame. */
  async update(x: number, z: number): Promise<void> {
    if (!this.active || this.active.kind !== 'streamed') return;
    await this.streamer.update(x, z);
  }

  private async loadChunk(chunk: ChunkManifest): Promise<void> {
    if (!this.active || !this.zoneScope) return;
    const scope = this.zoneScope.child(`chunk:${chunk.id}`);
    this.chunkScopes.set(chunk.id, scope);
    try {
      await this.builder.buildChunk(this.active, chunk, scope);
    } catch (err) {
      scope.dispose();
      this.chunkScopes.delete(chunk.id);
      throw err;
    }
  }

  private async unloadChunk(chunk: ChunkManifest): Promise<void> {
    const scope = this.chunkScopes.get(chunk.id);
    if (!scope) return;
    const report = scope.dispose();
    this.chunkScopes.delete(chunk.id);
    if (report.errors.length) {
      console.warn(`[LastHorizon] chunk ${chunk.id} disposed with errors`, report.errors);
    }
  }

  debugState(): ZoneDebugState {
    return {
      zoneId: this.active?.id ?? null,
      zoneName: this.active?.displayName ?? '—',
      kind: this.active?.kind ?? '—',
      residentChunks: this.streamer.debugResident(),
      residentCount: this.streamer.residentCount,
      trackedResources: this.zoneScope?.size ?? 0,
      travelling: this.travel.isTravelling,
    };
  }

  /** Full teardown. After this the manager owns nothing. */
  async dispose(): Promise<void> {
    await this.leave();
  }

  get worldManifest(): WorldManifest {
    return this.world;
  }
}
