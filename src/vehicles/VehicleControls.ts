/**
 * Turning whatever the player is holding into one `VehicleInput`.
 *
 * Three devices, one output. The controllers never learn which one is in use,
 * which is the only way "keyboard, gamepad and touch steering" stays honest —
 * otherwise each new surface adds a branch to the driving code.
 *
 * A gamepad wins when it is actually being pushed, per axis. Not "a pad is
 * connected", which would strand a player who has one plugged in and is using
 * the keyboard, and not "whichever moved last", which flickers when a thumb
 * rests on a stick.
 */

import type { GamepadState } from '../core/GamepadReader';
import type { VehicleCameraSpec, VehicleDefinition } from './VehicleDefinition';
import { normaliseInput, type VehicleInput } from './VehicleDynamics';

export interface MoveAxis {
  readonly x: number;
  readonly y: number;
}

/** Below this a stick or key axis counts as released. */
const AXIS_EPSILON = 0.02;

/**
 * Merge the devices.
 *
 * `move` carries the keyboard and the touch stick — they already share those
 * fields — where +y is forward and +x is right. On a vehicle forward means
 * throttle and back means brake, so the same stick that walks a character
 * drives a car without the player being told about it.
 */
export function vehicleInputFrom(
  move: MoveAxis,
  pad: GamepadState,
  handbrake: boolean,
): VehicleInput {
  const padded = pad.connected;

  const steer = padded && Math.abs(pad.steer) > AXIS_EPSILON ? pad.steer : move.x;

  // Triggers are analogue and take priority; the stick is the fallback so a
  // pad with broken triggers still drives.
  const padThrottle = padded && pad.throttle > AXIS_EPSILON ? pad.throttle : 0;
  const padBrake = padded && pad.brake > AXIS_EPSILON ? pad.brake : 0;

  const stickThrottle = Math.max(0, move.y);
  const stickBrake = Math.max(0, -move.y);

  return normaliseInput({
    steer,
    throttle: padThrottle > 0 ? padThrottle : stickThrottle,
    brake: padBrake > 0 ? padBrake : stickBrake,
    handbrake: handbrake || (padded && pad.held.has('handbrake')),
  });
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/** The subset of `CameraTuning` a vehicle overrides. */
export interface VehicleCameraTuning {
  distance: number;
  minDistance: number;
  maxDistance: number;
  height: number;
  positionLambda: number;
  targetLambda: number;
  shoulderOffset: number;
}

/**
 * Camera settings for a vehicle, pulled from its definition.
 *
 * Reuses the character camera rather than adding a second one: it already
 * handles occluder fade and pushing in when something is between the camera
 * and the subject, and a driving camera that did not would be a regression the
 * moment a car passed a wall.
 *
 * `speed` opens the view out as the vehicle goes faster, which is the cheapest
 * way to make speed legible without touching the field of view.
 */
export function vehicleCameraTuning(
  spec: VehicleCameraSpec,
  speed: number,
  maxSpeed: number,
): VehicleCameraTuning {
  const t = Math.min(1, Math.max(0, Math.abs(speed) / Math.max(maxSpeed, 0.001)));
  const distance = spec.distance + spec.speedPullback * t;
  return {
    distance,
    // The floor rises with speed too: letting the camera be shoved right up
    // against a fast car is how a near-miss becomes a screenful of paintwork.
    minDistance: spec.distance * 0.55 + spec.speedPullback * t * 0.5,
    maxDistance: distance + 3,
    height: spec.height,
    positionLambda: spec.stiffness,
    targetLambda: spec.stiffness * 2.2,
    // Vehicles are wide; an over-the-shoulder offset that suits a person puts
    // the camera inside the bodywork.
    shoulderOffset: 0,
  };
}

/**
 * Where the camera should sit behind the vehicle.
 *
 * Reversing swings it round toward the front so the player can see where they
 * are going. Partial, not a full flip: a camera that snaps 180 degrees the
 * instant reverse engages is disorienting, and the driver still needs to know
 * where the nose is.
 */
export function cameraYawFor(
  heading: number,
  spec: VehicleCameraSpec,
  reversing: boolean,
): number {
  return reversing ? heading + Math.PI * spec.reverseAssist : heading;
}

/** Should the camera treat this as reversing? Hysteresis avoids a flicker. */
export function isReversing(forwardSpeed: number, wasReversing: boolean): boolean {
  if (wasReversing) return forwardSpeed < 0.4;
  return forwardSpeed < -1.2;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface Dashboard {
  readonly speed: string;
  readonly gear: string;
  /** 0..1, for a bar. */
  readonly condition: number;
  /** Null when the vehicle never uses fuel. */
  readonly fuel: number | null;
  /** What the player can press right now. */
  readonly hints: readonly string[];
}

export function dashboard(
  def: VehicleDefinition,
  speedKmh: number,
  gear: string,
  condition: number,
  fuel: number | null,
): Dashboard {
  // "Right it" is listed even when the vehicle is the right way up: a player
  // who has just rolled onto their roof is not in a good position to go
  // looking for the control that fixes it.
  const hints = ['Exit', 'R: right it'];
  if (def.lights.some((l) => l.role === 'headlight')) hints.push('Lights');
  hints.push('Horn');

  return {
    speed: `${Math.round(Math.max(0, speedKmh))} km/h`,
    gear,
    condition: Math.min(1, Math.max(0, condition)),
    fuel: def.fuel === null ? null : Math.min(1, Math.max(0, fuel ?? 0)),
    hints,
  };
}
