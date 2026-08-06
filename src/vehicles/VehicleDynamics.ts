/**
 * The arithmetic behind driving, with no Rapier in sight.
 *
 * Everything here is a pure function of a `VehicleDefinition` and the current
 * state. That is deliberate: the interesting decisions in an arcade driving
 * model are not the solver's, they are these — how fast the wheel turns, when
 * throttle means "reverse" instead of "accelerate", how hard a bike is allowed
 * to right itself. Those need to be exercised at every speed and every angle,
 * which is easy against numbers and painful against a physics world.
 *
 * The controllers in this folder do the talking to Rapier and nothing else.
 *
 * Sign conventions match the rest of the repository: +Z forward, +Y up,
 * steering positive to the right, forward speed positive when driving forward.
 */

import type { VehicleDefinition } from './VehicleDefinition';
import { steeringLimitAt } from './VehicleDefinition';

/** What the player is asking for, device-independent and already normalised. */
export interface VehicleInput {
  /** -1 full left .. +1 full right. */
  readonly steer: number;
  /** 0..1. */
  readonly throttle: number;
  /** 0..1. Doubles as reverse once the vehicle has stopped. */
  readonly brake: number;
  readonly handbrake: boolean;
}

export const NEUTRAL_INPUT: VehicleInput = {
  steer: 0, throttle: 0, brake: 0, handbrake: false,
};

/** Direction of travel, as the HUD shows it. */
export type Gear = 'drive' | 'reverse' | 'neutral';

export interface DriveForces {
  /** Newtons along the vehicle's forward axis. Negative drives it backwards. */
  readonly engineForce: number;
  /** Newtons of braking, always positive. */
  readonly brakeForce: number;
  readonly gear: Gear;
}

/**
 * Speed below which the vehicle counts as stopped, m/s.
 *
 * Needs to be generous. Exactly zero never happens — a parked car always has a
 * few millimetres per second of suspension jitter — so a tighter threshold
 * would make "press brake to reverse" fail intermittently, which reads as the
 * controls not responding.
 */
export const STOPPED_SPEED = 0.6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, 1);

/** Sanitise raw device input. Non-finite values become neutral, not NaN forces. */
export function normaliseInput(raw: Partial<VehicleInput>): VehicleInput {
  const steer = Number.isFinite(raw.steer) ? clamp(raw.steer as number, -1, 1) : 0;
  return {
    steer,
    throttle: clamp01(raw.throttle ?? 0),
    brake: clamp01(raw.brake ?? 0),
    handbrake: raw.handbrake === true,
  };
}

/**
 * Move the steering angle toward what the player is asking for.
 *
 * Rate-limited rather than instant, so a flicked stick does not snap the wheels
 * sideways, and self-centring is faster than turning because letting go should
 * feel like the wheel returning on its own.
 */
export function stepSteering(
  def: VehicleDefinition,
  currentAngle: number,
  input: VehicleInput,
  forwardSpeed: number,
  dt: number,
): number {
  if (!Number.isFinite(dt) || dt <= 0) return currentAngle;

  const limit = steeringLimitAt(def, forwardSpeed);
  const target = clamp(input.steer, -1, 1) * limit;

  // Returning to centre uses the faster rate; actively steering uses the slower
  // one. Sign is not consulted -- only whether the player is asking for less.
  const returning = Math.abs(target) < Math.abs(currentAngle);
  const rate = returning ? def.steering.returnRate : def.steering.rate;
  const step = rate * limit * dt;

  const delta = target - currentAngle;
  const moved = Math.abs(delta) <= step ? target : currentAngle + Math.sign(delta) * step;

  // Clamp to the limit for the *current* speed: accelerating while already at
  // full lock must tighten the angle rather than leave it where it was.
  return clamp(moved, -limit, limit);
}

/**
 * Turn throttle and brake into forces, and decide which way the vehicle is going.
 *
 * This is the arcade automatic transmission players expect: throttle always
 * means "go forward", brake means "slow down", and brake held once stopped
 * means "reverse". No gear selection, and no way to be in the wrong one.
 *
 * The subtlety is that both pedals are also the *opposite* pedal when rolling
 * the other way. Throttle while rolling backwards has to brake, or a car that
 * has crept back down a slope lurches when the player tries to pull away.
 */
export function resolveDrive(
  def: VehicleDefinition,
  input: VehicleInput,
  forwardSpeed: number,
): DriveForces {
  const speed = Number.isFinite(forwardSpeed) ? forwardSpeed : 0;
  const rollingForward = speed > STOPPED_SPEED;
  const rollingBackward = speed < -STOPPED_SPEED;

  const { enginePower, brakeForce, engineBraking, maxSpeed, maxReverseSpeed } = def.drive;

  if (input.handbrake) {
    return { engineForce: 0, brakeForce, gear: rollingBackward ? 'reverse' : 'drive' };
  }

  // Throttle: forward, unless we are still rolling backwards.
  if (input.throttle > 0 && input.brake <= 0) {
    if (rollingBackward) {
      return { engineForce: 0, brakeForce: brakeForce * input.throttle, gear: 'reverse' };
    }
    // At the limiter the engine simply stops pushing. Cutting to zero rather
    // than fighting with a counter-force keeps top speed from feeling springy.
    const atLimit = speed >= maxSpeed;
    return {
      engineForce: atLimit ? 0 : enginePower * input.throttle,
      brakeForce: 0,
      gear: 'drive',
    };
  }

  // Brake: slow down, then reverse once stopped.
  if (input.brake > 0) {
    if (rollingForward) {
      return { engineForce: 0, brakeForce: brakeForce * input.brake, gear: 'drive' };
    }
    const atLimit = speed <= -maxReverseSpeed;
    return {
      engineForce: atLimit ? 0 : -enginePower * input.brake * reverseScale(def),
      brakeForce: 0,
      gear: 'reverse',
    };
  }

  // Nothing pressed: coast down. Engine braking only, so the vehicle rolls to
  // a stop instead of stopping dead the moment the player lets go.
  const coasting = Math.abs(speed) > STOPPED_SPEED ? engineBraking : brakeForce * 0.5;
  return {
    engineForce: 0,
    brakeForce: coasting,
    gear: rollingBackward ? 'reverse' : rollingForward ? 'drive' : 'neutral',
  };
}

/**
 * Reverse is weaker than forward, scaled so the two top speeds take a
 * comparable time to reach. Full engine power in reverse makes a car feel like
 * it is being fired backwards.
 */
function reverseScale(def: VehicleDefinition): number {
  return clamp(def.drive.maxReverseSpeed / Math.max(def.drive.maxSpeed, 0.001), 0.1, 1);
}

// ---------------------------------------------------------------------------
// Two-wheel balance
// ---------------------------------------------------------------------------

export interface BalanceResult {
  /** Corrective torque about the forward axis, N·m. Already capped. */
  readonly torque: number;
  /** How much assistance is active, 0..1. For debugging and the report. */
  readonly assist: number;
  /** True once past the fall angle: the rider is down. */
  readonly fallen: boolean;
}

/**
 * Keep a bicycle or scooter upright.
 *
 * Real two-wheelers are stable at speed and unstable at a standstill, which is
 * exactly backwards for a game: the moments a player spends parked, turning
 * around or setting off are the moments the vehicle would fall over. So the
 * assist is *strongest* at low speed and never reaches zero.
 *
 * The torque is a spring-damper toward upright, and it is capped hard. An
 * uncapped corrective torque is the single most likely way to launch the
 * player across the map, which the acceptance criteria forbid outright — so
 * the cap is not a tuning value, it is the guarantee.
 */
export function balanceTorque(
  def: VehicleDefinition,
  leanAngle: number,
  leanRate: number,
  forwardSpeed: number,
): BalanceResult {
  const b = def.balance;
  if (!b) return { torque: 0, assist: 0, fallen: false };

  const lean = Number.isFinite(leanAngle) ? leanAngle : 0;
  const rate = Number.isFinite(leanRate) ? leanRate : 0;
  const speed = Math.abs(Number.isFinite(forwardSpeed) ? forwardSpeed : 0);

  if (Math.abs(lean) >= b.fallAngle) {
    // Past the fall angle, stop fighting it. Continuing to push against a bike
    // that is already down is what produces a vehicle thrashing on its side.
    return { torque: 0, assist: 0, fallen: true };
  }

  // Full assistance at a standstill, tapering to a floor as speed rises.
  const t = clamp01(speed / Math.max(b.assistBelowSpeed, 0.001));
  const assist = 1 - 0.55 * t;

  const raw = -(b.uprightStrength * lean + b.uprightDamping * rate) * assist;
  const torque = clamp(raw, -b.maxRecoveryTorque, b.maxRecoveryTorque);

  return { torque, assist, fallen: false };
}

/**
 * Lean the bike into a corner, visually.
 *
 * Cosmetic: the target angle a renderer should roll the model to. Applying it
 * as a force would fight the balance assist, and the two would argue at every
 * corner.
 */
export function visualLean(
  def: VehicleDefinition,
  steerAngle: number,
  forwardSpeed: number,
): number {
  const b = def.balance;
  if (!b) return 0;
  const limit = steeringLimitAt(def, forwardSpeed);
  if (limit <= 0) return 0;

  // Lean scales with how hard the bike is actually turning, which is steering
  // *and* speed: full lock while stationary is a tight walk, not a lean.
  const turn = clamp(steerAngle / limit, -1, 1);
  const speedFactor = clamp01(Math.abs(forwardSpeed) / Math.max(def.drive.maxSpeed, 0.001));
  return -turn * b.maxLean * speedFactor;
}

/** Signed lean from a vehicle's up vector. Positive is a lean to its right. */
export function leanFromUp(upX: number, upY: number): number {
  if (!Number.isFinite(upX) || !Number.isFinite(upY)) return 0;
  return Math.atan2(upX, Math.max(upY, -1));
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Speedometer reading in km/h, which is what a player expects to see. */
export function speedKmh(forwardSpeed: number): number {
  if (!Number.isFinite(forwardSpeed)) return 0;
  return Math.abs(forwardSpeed) * 3.6;
}

export function gearLabel(gear: Gear): string {
  return gear === 'reverse' ? 'R' : gear === 'neutral' ? 'N' : 'D';
}

/**
 * How much grip is left, given condition.
 *
 * Damage is cosmetic by design, but a vehicle that has been thoroughly wrecked
 * should feel a little worse to drive or the damage model means nothing at all.
 * Bounded well above zero: an undriveable car strands the player.
 */
export function conditionGripScale(def: VehicleDefinition, condition: number): number {
  const c = clamp01(condition);
  if (c >= def.damage.impairedBelow) return 1;
  const t = c / Math.max(def.damage.impairedBelow, 0.001);
  return 0.8 + 0.2 * t;
}
