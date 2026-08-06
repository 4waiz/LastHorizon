/**
 * Getting in and out of a vehicle.
 *
 * The acceptance criterion is blunt: *the player cannot exit inside a wall,
 * under a moving vehicle, or over a cliff.* That is not something to check
 * once at the door and hope — it is a search over candidate spots, each of
 * which has to be proved safe before it is offered.
 *
 * All of it is pure. The world is reached through a `PlacementProbe`, so a
 * cliff, a wall and a moving car can all be produced on demand in a test
 * instead of hunting for somewhere in the village that happens to have one.
 */

import type { SeatSpec, VehicleDefinition } from './VehicleDefinition';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where a vehicle is, in world space. */
export interface VehiclePose {
  readonly position: Point3;
  /** Heading, radians, glTF convention: atan2(forward.x, forward.z). */
  readonly yaw: number;
  /** Metres per second. A vehicle still rolling is not safe to step out of. */
  readonly speed: number;
}

/**
 * What the world can answer about a spot.
 *
 * Deliberately small. Anything richer would need a physics world to test
 * against, and the interesting cases here are the ones a real village rarely
 * has lying around at a convenient angle.
 */
export interface PlacementProbe {
  /**
   * Ground height at x/z, or null where there is none — off the terrain, over
   * water, past the edge of the world. Null is what "over a cliff" means here.
   */
  groundAt(x: number, z: number): number | null;
  /** Is a standing-sized space free at this point? */
  isClear(x: number, y: number, z: number, radius: number): boolean;
}

/** Radius of the space a standing person needs. */
export const PERSON_RADIUS = 0.34;
/** Head-to-toe clearance checked above the ground. */
export const PERSON_HEIGHT = 1.75;

/**
 * Biggest step down from the vehicle's own height that still counts as ground
 * rather than a drop. Stepping out onto a kerb is fine; stepping out over a
 * retaining wall is the thing this exists to refuse.
 */
export const MAX_EXIT_DROP = 1.6;

/** Above this speed the vehicle is still moving and nobody may get out. */
export const MAX_EXIT_SPEED = 1.2;

export type ExitRefusal =
  | 'moving'
  | 'blocked'
  | 'noGround'
  | 'drop';

export interface ExitPlacement {
  readonly ok: true;
  readonly position: Point3;
  readonly seat: SeatSpec;
  /** True when the first choice was unusable and a fallback was taken. */
  readonly fallback: boolean;
}

export interface ExitRefused {
  readonly ok: false;
  readonly reason: ExitRefusal;
}

export type ExitResult = ExitPlacement | ExitRefused;

/** Rotate a chassis-local offset into world space. */
export function toWorld(pose: VehiclePose, local: Point3): Point3 {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return {
    x: pose.position.x + local.x * c + local.z * s,
    y: pose.position.y + local.y,
    z: pose.position.z - local.x * s + local.z * c,
  };
}

/**
 * Candidate spots for a seat, best first.
 *
 * The seat's own `exitOffset` is the natural one. After that, the mirrored
 * offset — stepping out the other side is better than not being able to get
 * out — then behind the vehicle, which is nearly always clear of traffic and
 * of the vehicle itself.
 */
function candidates(seat: SeatSpec, def: VehicleDefinition): Point3[] {
  const o = seat.exitOffset;
  const back = -(def.dimensions.z / 2 + 0.9);
  return [
    o,
    { x: -o.x, y: o.y, z: o.z },
    { x: 0, y: o.y, z: back },
    { x: o.x * 1.5, y: o.y, z: o.z },
    { x: -o.x * 1.5, y: o.y, z: o.z },
  ];
}

/**
 * Find somewhere safe to put the player.
 *
 * Refuses outright while the vehicle is moving. A player who steps out of a
 * car doing 40 km/h either falls through the world or is left behind at the
 * spot they pressed the button, and both read as a bug.
 */
export function exitPlacement(
  def: VehicleDefinition,
  seat: SeatSpec,
  pose: VehiclePose,
  probe: PlacementProbe,
): ExitResult {
  if (!Number.isFinite(pose.speed) || Math.abs(pose.speed) > MAX_EXIT_SPEED) {
    return { ok: false, reason: 'moving' };
  }

  // How far each candidate got before it was rejected. The player is told
  // about the *closest* any of them came to working, which is the useful
  // thing: "no room" when the ground was fine, "too far down" when it was not.
  let sawGround = false;
  let sawReachableGround = false;

  const options = candidates(seat, def);
  for (let i = 0; i < options.length; i++) {
    const world = toWorld(pose, options[i]);

    const ground = probe.groundAt(world.x, world.z);
    if (ground === null) continue;            // over a cliff, or off the map
    sawGround = true;

    // A long way below the vehicle is a drop, not a step.
    if (pose.position.y - ground > MAX_EXIT_DROP) continue;
    sawReachableGround = true;

    // Stand the player *on* the ground, then check they fit there. Checking at
    // the seat's height would clear a spot whose floor is a metre lower.
    if (!probe.isClear(world.x, ground, world.z, PERSON_RADIUS)) continue;

    return {
      ok: true,
      position: { x: world.x, y: ground, z: world.z },
      seat,
      fallback: i > 0,
    };
  }

  if (!sawGround) return { ok: false, reason: 'noGround' };
  if (!sawReachableGround) return { ok: false, reason: 'drop' };
  return { ok: false, reason: 'blocked' };
}

/** A message the HUD can show when an exit is refused. */
export function exitRefusalText(reason: ExitRefusal): string {
  switch (reason) {
    case 'moving': return 'Slow down first';
    case 'noGround': return 'Not here — nothing to step onto';
    case 'drop': return 'Too far down';
    default: return 'No room to get out';
  }
}

// ---------------------------------------------------------------------------
// Getting in
// ---------------------------------------------------------------------------

export interface SeatChoice {
  readonly seat: SeatSpec;
  /** Distance from the player to that seat's door, metres. */
  readonly distance: number;
}

/**
 * The seat whose door the player is standing nearest.
 *
 * "Choose nearest safe door or side" from the brief. Walking round to the
 * driver's side to get in the driver's seat is what a player expects; being
 * teleported across the car is not.
 */
export function nearestSeat(
  def: VehicleDefinition,
  pose: VehiclePose,
  from: Point3,
  opts: { driverOnly?: boolean } = {},
): SeatChoice | null {
  const seats = opts.driverOnly
    ? def.seats.filter((s) => s.role === 'driver')
    : def.seats;
  if (seats.length === 0) return null;

  let best: SeatChoice | null = null;
  for (const seat of seats) {
    const door = toWorld(pose, seat.exitOffset);
    const distance = Math.hypot(door.x - from.x, door.z - from.z);
    if (!best || distance < best.distance) best = { seat, distance };
  }
  return best;
}

export type EntryRefusal = 'locked' | 'noKey' | 'moving' | 'occupied';

export interface EntryContext {
  /** Item ids the player is carrying. */
  readonly keys: ReadonlySet<string>;
  readonly locked: boolean;
  /** Seat ids already taken. */
  readonly occupied: ReadonlySet<string>;
}

export interface EntryAllowed {
  readonly ok: true;
  readonly seat: SeatSpec;
}

export interface EntryRefused {
  readonly ok: false;
  readonly reason: EntryRefusal;
}

/**
 * May the player get into this seat?
 *
 * A locked vehicle can still be entered by whoever holds its key — that is the
 * point of the key. Checking the key first would mean an unlocked car still
 * demanded one.
 */
export function canEnter(
  def: VehicleDefinition,
  seat: SeatSpec,
  pose: VehiclePose,
  ctx: EntryContext,
): EntryAllowed | EntryRefused {
  if (ctx.occupied.has(seat.id)) return { ok: false, reason: 'occupied' };

  // Getting into something already rolling is how a player ends up inside the
  // geometry of a vehicle that has moved on without them.
  if (!Number.isFinite(pose.speed) || Math.abs(pose.speed) > MAX_EXIT_SPEED) {
    return { ok: false, reason: 'moving' };
  }

  const key = def.ownership.keyItem;
  const hasKey = key !== null && ctx.keys.has(key);

  if (ctx.locked && !hasKey) return { ok: false, reason: 'locked' };
  if (def.ownership.requiresKey && !hasKey) return { ok: false, reason: 'noKey' };

  return { ok: true, seat };
}

export function entryRefusalText(reason: EntryRefusal): string {
  switch (reason) {
    case 'locked': return "It's locked";
    case 'noKey': return 'You need the key';
    case 'moving': return "It's still moving";
    default: return 'Someone is already there';
  }
}

/** Where the occupant sits, in world space. */
export function seatWorldPosition(pose: VehiclePose, seat: SeatSpec): Point3 {
  return toWorld(pose, seat.position);
}
