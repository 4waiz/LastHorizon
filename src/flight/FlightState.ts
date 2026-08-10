import type { FlightSaveData } from './FlightModel';

/**
 * What the save layer needs to know about flying.
 *
 * The eager half, exactly like `CombatState` and `StoryState` before it: the
 * split rule this repository has used since Phase 7 is *what does the save
 * layer touch on the first frame?* `SaveService` has to write where the
 * aeroplane was parked whether or not anybody has been near it, and the HUD
 * has to know whether to show an airspeed readout before the flight chunk
 * exists.
 *
 * Everything that *does* anything — the flight model, the boundary, the
 * director — is behind `FlightSubsystem`'s dynamic import and is never fetched
 * by a player who stays in the village.
 *
 * No logic here on purpose. The moment this file starts deciding anything it
 * has to import the model, and then it is not the eager half any more.
 */

export interface FlightSaveState {
  /** Serialised model state, or null if nobody has flown. */
  flight: FlightSaveData | null;
  /** Where the aeroplane is parked when nobody is in it. */
  parked: { x: number; y: number; z: number; facing: number } | null;
  /** Times the player has been recovered from a crash or a boundary. */
  recoveries: number;
}

export class FlightState {
  flight: FlightSaveData | null = null;
  parked: { x: number; y: number; z: number; facing: number } | null = null;
  recoveries = 0;

  /** Mirrors the HUD reads without the flight chunk being present. */
  airborne = false;
  airspeed = 0;
  altitude = 0;
  stallWarning = false;
  /** 0 inside, rising to 1 at the edge of the world. Drives the haze. */
  boundaryPressure = 0;

  toJSON(): FlightSaveState {
    return {
      flight: this.flight ? { ...this.flight } : null,
      parked: this.parked ? { ...this.parked } : null,
      recoveries: this.recoveries,
    };
  }

  restore(data: Partial<FlightSaveState> | undefined): void {
    this.flight = data?.flight ?? null;
    this.parked = data?.parked ?? null;
    this.recoveries =
      typeof data?.recoveries === 'number' && Number.isFinite(data.recoveries)
        ? data.recoveries
        : 0;
    this.airborne = false;
    this.airspeed = 0;
    this.altitude = 0;
    this.stallWarning = false;
    this.boundaryPressure = 0;
  }
}
