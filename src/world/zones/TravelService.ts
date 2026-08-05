import type { SpawnPoint, ZoneId } from './Manifest';
import type { SpawnRegistry } from './SpawnRegistry';

/**
 * Moves the player between zones without ever losing them.
 *
 * Two rules drive the design:
 *
 * 1. **Return context is preserved.** Travel records where the player came
 *    from — which door, which vehicle — so returning puts them back where
 *    they left rather than at a generic entry point.
 * 2. **A failed journey is a no-op, not a broken save.** If the destination
 *    cannot be prepared, the player stays in the source zone with a readable
 *    message and unchanged state. Nothing is torn down until the destination
 *    has resolved a valid spawn.
 */

export interface TravelContext {
  readonly fromZone: ZoneId;
  /** The exterior door or lane node the player departed from, if any. */
  readonly fromSpawnId?: string;
  readonly withVehicle?: boolean;
  readonly vehicleId?: string;
}

export interface TravelRequest {
  readonly to: ZoneId;
  readonly toSpawnId?: string;
  readonly context: TravelContext;
  /** Metres of clearance the arriving body needs. */
  readonly requiredClearance?: number;
}

export type TravelResult =
  | {
      ok: true;
      zoneId: ZoneId;
      spawn: SpawnPoint;
      usedFallbackSpawn: boolean;
      note?: string;
      /** Enough to travel straight back to where this journey started. */
      returnContext: TravelContext;
    }
  | { ok: false; stayedIn: ZoneId; message: string };

export interface TravelHooks {
  /**
   * Prepare the destination: load bundles, build chunks, warm colliders.
   * Rejecting here must leave the source zone untouched.
   */
  prepare(zoneId: ZoneId): Promise<void>;
  /** Tear the previous zone down. Only called after `prepare` succeeded. */
  release(zoneId: ZoneId): Promise<void>;
  /** Cover the seam. Visual continuity matters more than instant arrival. */
  fade?(direction: 'out' | 'in'): Promise<void>;
}

export class TravelService {
  private travelling = false;
  private history: TravelContext[] = [];

  constructor(
    private readonly spawns: SpawnRegistry,
    private readonly hooks: TravelHooks,
  ) {}

  get isTravelling(): boolean {
    return this.travelling;
  }

  /** The context that would be used by `returnHome()`, if any. */
  get lastContext(): TravelContext | null {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  async travel(req: TravelRequest): Promise<TravelResult> {
    if (this.travelling) {
      return { ok: false, stayedIn: req.context.fromZone, message: 'Already travelling.' };
    }

    const source = this.spawns.zone(req.context.fromZone);
    const dest = this.spawns.zone(req.to);
    if (!dest) {
      return { ok: false, stayedIn: req.context.fromZone, message: `There is no route to ${req.to}.` };
    }
    if (!dest.playable) {
      return {
        ok: false,
        stayedIn: req.context.fromZone,
        message: `${dest.displayName} is not open yet.`,
      };
    }
    if (source && !source.neighbours.includes(req.to)) {
      return {
        ok: false,
        stayedIn: req.context.fromZone,
        message: `${dest.displayName} cannot be reached directly from here.`,
      };
    }

    // Resolve the arrival *before* touching the current zone. If there is
    // nowhere safe to land, nothing has been torn down and the player has not
    // moved.
    const resolution = this.spawns.resolve({
      zoneId: req.to,
      spawnId: req.toSpawnId,
      withVehicle: req.context.withVehicle,
      requiredClearance: req.requiredClearance,
    });

    if (!resolution.ok) {
      return {
        ok: false,
        stayedIn: req.context.fromZone,
        message: `Could not find a safe place to arrive in ${dest.displayName}.`,
      };
    }

    this.travelling = true;
    try {
      await this.hooks.fade?.('out');

      try {
        await this.hooks.prepare(req.to);
      } catch (err) {
        // Destination failed to build. Fade back in on the source zone: the
        // player has not moved and no state has been mutated.
        await this.hooks.fade?.('in');
        console.warn(`[LastHorizon] travel to ${req.to} failed during prepare`, err);
        return {
          ok: false,
          stayedIn: req.context.fromZone,
          message: `${dest.displayName} could not be loaded. You are still in ${
            source?.displayName ?? 'the same place'
          }.`,
        };
      }

      // Only now is it safe to release the old zone.
      if (source && source.id !== req.to) {
        try {
          await this.hooks.release(source.id);
        } catch (err) {
          // A messy teardown is a leak, not a lost player: the arrival has
          // already succeeded, so continue and report.
          console.warn(`[LastHorizon] zone ${source.id} did not release cleanly`, err);
        }
      }

      const returnContext: TravelContext = {
        fromZone: req.to,
        fromSpawnId: resolution.spawn.id,
        withVehicle: req.context.withVehicle,
        vehicleId: req.context.vehicleId,
      };
      this.history.push(req.context);

      await this.hooks.fade?.('in');

      return {
        ok: true,
        zoneId: resolution.zoneId,
        spawn: resolution.spawn,
        usedFallbackSpawn: resolution.fallback,
        note: resolution.reason,
        returnContext,
      };
    } finally {
      this.travelling = false;
    }
  }

  /** Travel back the way we came, landing at the door we left from. */
  async returnHome(currentZone: ZoneId): Promise<TravelResult> {
    const prev = this.history.pop();
    if (!prev) {
      return { ok: false, stayedIn: currentZone, message: 'Nowhere to go back to.' };
    }
    const result = await this.travel({
      to: prev.fromZone,
      toSpawnId: prev.fromSpawnId,
      context: { fromZone: currentZone, withVehicle: prev.withVehicle, vehicleId: prev.vehicleId },
    });
    // A failed return must not silently consume the history entry.
    if (!result.ok) this.history.push(prev);
    return result;
  }
}
