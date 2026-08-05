import type { SpawnPoint, WorldManifest, ZoneId, ZoneManifest } from './Manifest';
import { withinBounds } from './Manifest';

/**
 * Resolves where a player materialises, and refuses to strand them.
 *
 * Every arrival goes through here. The rules exist because the failure modes
 * are specific and unpleasant: a saved spawn whose chunk no longer exists, an
 * arrival by vehicle onto a footpath, or a spawn that has drifted outside its
 * zone bounds after a manifest edit. Each of those puts the player somewhere
 * they cannot act, so resolution always ends at *some* valid point.
 */

export interface SpawnRequest {
  readonly zoneId: ZoneId;
  /** Preferred spawn; may no longer exist, which is not an error. */
  readonly spawnId?: string;
  /** Arriving in a vehicle constrains which spawns are acceptable. */
  readonly withVehicle?: boolean;
  /** Minimum clearance the arriving body needs, in metres. */
  readonly requiredClearance?: number;
}

export type SpawnResolution =
  | { ok: true; zoneId: ZoneId; spawn: SpawnPoint; fallback: boolean; reason?: string }
  | { ok: false; reason: string };

export class SpawnRegistry {
  private readonly byZone = new Map<ZoneId, ZoneManifest>();

  constructor(world: WorldManifest) {
    for (const z of world.zones) this.byZone.set(z.id, z);
  }

  zone(id: ZoneId): ZoneManifest | null {
    return this.byZone.get(id) ?? null;
  }

  list(zoneId: ZoneId): readonly SpawnPoint[] {
    return this.byZone.get(zoneId)?.spawns ?? [];
  }

  /** True if this spawn can accept the request's constraints. */
  private accepts(zone: ZoneManifest, s: SpawnPoint, req: SpawnRequest): boolean {
    if (req.withVehicle && !s.vehicleSafe) return false;
    if (req.requiredClearance !== undefined && s.clearance < req.requiredClearance) return false;
    // A spawn outside its own zone bounds is a manifest bug; never use it.
    if (!withinBounds(zone, s.x, s.z)) return false;
    return true;
  }

  /**
   * Resolve a spawn, degrading gracefully:
   *   1. the requested spawn, if it exists and accepts the constraints;
   *   2. the zone default, if it accepts them;
   *   3. any accepting spawn, chosen deterministically by id;
   *   4. failure — reported, never a silent drop into empty space.
   */
  resolve(req: SpawnRequest): SpawnResolution {
    const zone = this.byZone.get(req.zoneId);
    if (!zone) return { ok: false, reason: `unknown zone ${req.zoneId}` };
    if (!zone.playable) return { ok: false, reason: `zone ${req.zoneId} is not playable yet` };

    if (req.spawnId) {
      const asked = zone.spawns.find((s) => s.id === req.spawnId);
      if (asked && this.accepts(zone, asked, req)) {
        return { ok: true, zoneId: zone.id, spawn: asked, fallback: false };
      }
    }

    const def = zone.spawns.find((s) => s.id === zone.defaultSpawnId);
    if (def && this.accepts(zone, def, req)) {
      return {
        ok: true,
        zoneId: zone.id,
        spawn: def,
        fallback: !!req.spawnId,
        reason: req.spawnId ? `spawn ${req.spawnId} unavailable; used zone default` : undefined,
      };
    }

    // Deterministic order so a fallback is reproducible run to run.
    const any = [...zone.spawns]
      .filter((s) => this.accepts(zone, s, req))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];

    if (any) {
      return {
        ok: true,
        zoneId: zone.id,
        spawn: any,
        fallback: true,
        reason: req.withVehicle
          ? 'no preferred vehicle-safe spawn; used the first acceptable one'
          : 'no preferred spawn; used the first acceptable one',
      };
    }

    return {
      ok: false,
      reason: req.withVehicle
        ? `zone ${req.zoneId} has no vehicle-safe spawn meeting the request`
        : `zone ${req.zoneId} has no spawn meeting the request`,
    };
  }
}
