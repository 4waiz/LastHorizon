/**
 * Everything about flying that a player who never leaves the village needs.
 *
 * The fourth time this repository has drawn this line, and the rule has not
 * changed since Phase 7: **what does the save layer touch on the first frame?**
 * That, and only that, is eager.
 *
 * Eager, in `FlightState.ts`: where the aeroplane is parked, the serialised
 * model blob, the recovery count, and five numbers the HUD mirrors.
 * `SaveService` has to write a parked aeroplane whether or not anybody has
 * been near it.
 *
 * Lazy, behind this file: the flight model, the boundary, the checkpoints and
 * the director. Fetched the first time somebody walks up to the aeroplane,
 * alongside the 58.5 kB of `aircraft.glb` — which is the same moment, so the
 * code rides in a gap the art was already paying for.
 */

export { FlightDirector, type FlightDirectorHost } from './FlightDirector';
export {
  FlightModel,
  PLANE_TUNING,
  NEUTRAL_INPUT,
  GRAVITY,
  type AssistLevel,
  type FlightHost,
  type FlightInput,
  type FlightSaveData,
  type FlightState as FlightSnapshot,
  type FlightTuning,
} from './FlightModel';
export {
  evaluate,
  nearestCheckpoint,
  CHECKPOINTS,
  FLIGHT_CORRIDOR,
  GROUND_BOUNDS,
  type BoundaryReason,
  type BoundaryVerdict,
  type BoundaryZone,
  type BoundsConfig,
  type Checkpoint,
  type RecoveryKind,
} from './WorldBounds';
