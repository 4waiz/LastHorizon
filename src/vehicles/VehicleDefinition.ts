/**
 * What a vehicle *is*, as data.
 *
 * Every vehicle in the game is one of these plus a mesh. Nothing about
 * handling, seating, lighting or ownership is expressed as a subclass or a
 * `switch` on the id — Phase 4 spent real effort removing exactly that pattern
 * from interactions, and a fleet of vehicles is where it would come back worst.
 *
 * The split that matters is `kind`: `fourWheel` vehicles go to Rapier's
 * ray-cast vehicle controller, `twoWheel` ones to a balance controller that
 * Rapier does not provide. Everything else here is shared, so a scooter and a
 * van differ in numbers rather than in code paths.
 *
 * Units are SI throughout: metres, kilograms, seconds, radians. Positions are
 * chassis-local, +Z forward and +Y up, matching the glTF convention the rest of
 * the repository uses.
 */

export type VehicleId = 'bicycle' | 'scooter' | 'hatchback' | 'van' | 'police';

/** Which controller drives it. Two-wheelers need assisted balance. */
export type VehicleKind = 'twoWheel' | 'fourWheel';

/** Pedals never need fuel; engines optionally do. */
export type Propulsion = 'pedal' | 'engine';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---------------------------------------------------------------------------
// Wheels and suspension
// ---------------------------------------------------------------------------

export interface WheelSpec {
  readonly id: string;
  /** Where the suspension is anchored on the chassis. */
  readonly position: Vec3;
  readonly radius: number;
  readonly width: number;
  readonly steered: boolean;
  readonly powered: boolean;
  readonly braked: boolean;
}

export interface SuspensionSpec {
  /** Spring length at rest. The chassis rides this far above the axle. */
  readonly restLength: number;
  readonly stiffness: number;
  /** Damping while the spring shortens — hitting a kerb. */
  readonly compression: number;
  /** Damping while it extends again. Softer, or the vehicle skips. */
  readonly relaxation: number;
  /** Ceiling on the force one wheel may push with. A guard, not a tuning knob. */
  readonly maxForce: number;
  /** Maximum travel from rest, in metres. */
  readonly maxTravel: number;
}

export interface GripSpec {
  /** Sideways force before the tyre lets go. Higher grips harder. */
  readonly sideFriction: number;
  /** How much grip is lost at full speed, 0..1. Keeps fast cornering calm. */
  readonly speedFalloff: number;
  /** Extra grip while barely moving, so parking is not skittish. */
  readonly lowSpeedBonus: number;
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

export interface DriveSpec {
  /** Metres per second. `PhysicsWorld.MAX_SPEED` is the hard ceiling above this. */
  readonly maxSpeed: number;
  readonly maxReverseSpeed: number;
  /** Force applied by the powered wheels at full throttle, newtons. */
  readonly enginePower: number;
  readonly brakeForce: number;
  /** Braking applied when nothing is pressed, so a vehicle coasts to a stop. */
  readonly engineBraking: number;
  /** Seconds from standstill to `maxSpeed`, for tuning and for the report. */
  readonly zeroToTopSeconds: number;
}

export interface SteeringSpec {
  /** Maximum steering angle at a standstill, radians. */
  readonly maxAngle: number;
  /**
   * How much the maximum shrinks as speed rises, 0..1. Without this, a flick
   * of the wheel at speed spins the car — the single least forgiving thing an
   * arcade driving model can do.
   */
  readonly speedSensitivity: number;
  /** Radians per second the wheel turns toward the input. */
  readonly rate: number;
  /** Radians per second it self-centres when the input is released. */
  readonly returnRate: number;
}

/**
 * Two-wheel balance. Null for cars.
 *
 * Rapier has no motorcycle controller, so this is the tuning for the one in
 * `TwoWheelController`. Every value here is a *limit* as much as a strength:
 * the acceptance criterion is that the player is never launched, so an upright
 * torque that could fling the bike is a bug however good it looks.
 */
export interface BalanceSpec {
  /** Below this speed the rider needs help staying up, m/s. */
  readonly assistBelowSpeed: number;
  /** Corrective torque toward upright. Capped by `maxRecoveryTorque`. */
  readonly uprightStrength: number;
  readonly uprightDamping: number;
  /** Hard ceiling on corrective torque, newton-metres. */
  readonly maxRecoveryTorque: number;
  /** Lean angle at full cornering, radians. Visual, not a force. */
  readonly maxLean: number;
  /** Past this angle the rider has fallen and the reset path takes over. */
  readonly fallAngle: number;
  /** Seconds lying down before an automatic righting. */
  readonly fallRecoverySeconds: number;
}

// ---------------------------------------------------------------------------
// Occupants
// ---------------------------------------------------------------------------

export type SeatRole = 'driver' | 'passenger';
/** Which side the occupant gets in and out of. */
export type DoorSide = 'left' | 'right' | 'rear' | 'straddle';

export interface SeatSpec {
  readonly id: string;
  readonly role: SeatRole;
  /** Where the occupant sits, chassis-local. */
  readonly position: Vec3;
  readonly door: DoorSide;
  /**
   * Where the occupant stands after getting out, chassis-local.
   *
   * Only a *candidate*: `exitPlacement` still has to prove the spot is clear
   * and on solid ground, because "the player cannot exit inside a wall, under
   * a moving vehicle, or over a cliff" is an acceptance criterion.
   */
  readonly exitOffset: Vec3;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export interface VehicleCameraSpec {
  readonly distance: number;
  readonly height: number;
  readonly pitch: number;
  /** Extra distance at top speed, so fast driving opens the view out. */
  readonly speedPullback: number;
  /** How far the camera swings toward the back when reversing, 0..1. */
  readonly reverseAssist: number;
  /** Spring constant for the follow. Higher is tighter and twitchier. */
  readonly stiffness: number;
}

export type LightRole = 'headlight' | 'brake' | 'reverse' | 'indicator' | 'beacon';

export interface LightSpec {
  readonly id: string;
  readonly role: LightRole;
  readonly position: Vec3;
  readonly colour: string;
  readonly intensity: number;
}

export interface AudioSpec {
  /** Which synthesised profile `AudioManager` should use. */
  readonly profile: 'pedal' | 'smallEngine' | 'carEngine' | 'vanEngine';
  readonly idleHz: number;
  readonly maxHz: number;
  readonly hornHz: number;
  readonly volume: number;
}

export interface LodSpec {
  /** Distance in metres at which this level takes over. */
  readonly distance: number;
  /** Node suffix in the GLB, e.g. `_LOD1`. Empty means the base mesh. */
  readonly suffix: string;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface DamageSpec {
  /** Impact speed below which nothing marks, m/s. Kerbs must not scratch. */
  readonly scratchSpeed: number;
  /** Impact speed that produces visible cosmetic damage. */
  readonly dentSpeed: number;
  /** Condition at which handling starts to suffer, 0..1. */
  readonly impairedBelow: number;
  /** Cost to repair to pristine. */
  readonly repairCost: number;
}

export interface OwnershipSpec {
  /** Can the player own this at all? */
  readonly ownable: boolean;
  /** Does entering require a key in the inventory? */
  readonly requiresKey: boolean;
  /** Catalogue item id of that key, if any. */
  readonly keyItem: string | null;
  readonly lockable: boolean;
  /** Can it be impounded when left somewhere it should not be? */
  readonly impoundable: boolean;
  /** Price when bought, or null if it is never for sale. */
  readonly price: number | null;
}

export interface FuelSpec {
  readonly capacity: number;
  /** Litres per kilometre at cruising speed. */
  readonly consumptionPerKm: number;
  readonly refillCost: number;
}

export interface SpawnSpec {
  /** Zones this may be placed in. Empty means anywhere. */
  readonly zones: readonly string[];
  /** Clear radius needed to spawn without intersecting something. */
  readonly clearance: number;
  /** Must it start on a road, or will any flat ground do? */
  readonly requiresRoad: boolean;
  /** Steepest ground it may be placed on, radians. */
  readonly maxSlope: number;
}

// ---------------------------------------------------------------------------
// The definition
// ---------------------------------------------------------------------------

export interface VehicleDefinition {
  readonly id: VehicleId;
  readonly displayName: string;
  readonly kind: VehicleKind;
  readonly propulsion: Propulsion;

  /** GLB node name. Models live in `public/assets/models/vehicles.glb`. */
  readonly model: string;
  readonly lods: readonly LodSpec[];
  /**
   * Node used for physics instead of the render mesh.
   *
   * Same reasoning as `CollisionWorld`'s proxies: a wheel arch or a wing
   * mirror in the collision hull turns every kerb into a snag.
   */
  readonly collisionProxy: string;
  /** Palette colours this may be tinted with, driven by material parameters. */
  readonly colourVariants: readonly string[];

  readonly mass: number;
  /** Full extents (not half), metres: width, height, length. */
  readonly dimensions: Vec3;
  /** Centre of mass, chassis-local. Low and slightly rearward is stable. */
  readonly centreOfMass: Vec3;

  readonly wheels: readonly WheelSpec[];
  readonly suspension: SuspensionSpec;
  readonly grip: GripSpec;
  readonly drive: DriveSpec;
  readonly steering: SteeringSpec;
  /** Present exactly when `kind` is `twoWheel`. */
  readonly balance: BalanceSpec | null;
  /** Where the rider's hands go on a two-wheeler. Null for cars. */
  readonly handlebarSockets: readonly Vec3[] | null;

  readonly seats: readonly SeatSpec[];
  readonly camera: VehicleCameraSpec;
  readonly lights: readonly LightSpec[];
  readonly audio: AudioSpec;

  readonly damage: DamageSpec;
  readonly ownership: OwnershipSpec;
  /** Null for anything that never burns fuel — the bicycle, always. */
  readonly fuel: FuelSpec | null;
  readonly spawn: SpawnSpec;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check a definition is internally consistent.
 *
 * These are the mistakes that produce a vehicle which loads, drives, and is
 * quietly wrong — a car with no powered wheel that simply will not move, a
 * two-wheeler with no balance block that falls over on spawn, a bicycle that
 * asks for petrol. Every one of them is cheaper to catch here than in a
 * play session.
 */
export function validateDefinition(def: VehicleDefinition): string[] {
  const errors: string[] = [];
  const where = `${def.id}:`;

  if (def.mass <= 0) errors.push(`${where} mass must be positive`);
  if (def.wheels.length === 0) errors.push(`${where} has no wheels`);

  const expectedWheels = def.kind === 'twoWheel' ? 2 : 4;
  if (def.wheels.length !== expectedWheels) {
    errors.push(`${where} ${def.kind} needs ${expectedWheels} wheels, has ${def.wheels.length}`);
  }

  if (!def.wheels.some((w) => w.powered)) errors.push(`${where} no powered wheel`);
  if (!def.wheels.some((w) => w.steered)) errors.push(`${where} no steered wheel`);
  if (!def.wheels.some((w) => w.braked)) errors.push(`${where} no braked wheel`);

  const ids = new Set(def.wheels.map((w) => w.id));
  if (ids.size !== def.wheels.length) errors.push(`${where} duplicate wheel ids`);
  for (const w of def.wheels) {
    if (w.radius <= 0) errors.push(`${where} wheel ${w.id} has non-positive radius`);
  }

  // A two-wheeler without balance tuning falls over the moment it spawns.
  if (def.kind === 'twoWheel' && def.balance === null) {
    errors.push(`${where} twoWheel needs a balance spec`);
  }
  if (def.kind === 'fourWheel' && def.balance !== null) {
    errors.push(`${where} fourWheel must not carry a balance spec`);
  }
  if (def.kind === 'twoWheel' && (def.handlebarSockets?.length ?? 0) !== 2) {
    errors.push(`${where} twoWheel needs two handlebar sockets`);
  }

  if (def.balance && def.balance.fallAngle <= def.balance.maxLean) {
    errors.push(`${where} fallAngle must exceed maxLean, or a hard corner reads as a crash`);
  }
  if (def.balance && def.balance.maxRecoveryTorque <= 0) {
    errors.push(`${where} recovery torque must be capped above zero`);
  }

  const drivers = def.seats.filter((s) => s.role === 'driver');
  if (drivers.length !== 1) errors.push(`${where} needs exactly one driver seat, has ${drivers.length}`);
  const seatIds = new Set(def.seats.map((s) => s.id));
  if (seatIds.size !== def.seats.length) errors.push(`${where} duplicate seat ids`);

  // Pedals never take petrol, whatever the fuel system is set to.
  if (def.propulsion === 'pedal' && def.fuel !== null) {
    errors.push(`${where} pedal-powered vehicles must not define fuel`);
  }
  if (def.fuel && def.fuel.capacity <= 0) errors.push(`${where} fuel capacity must be positive`);

  if (def.drive.maxSpeed <= 0) errors.push(`${where} maxSpeed must be positive`);
  if (def.drive.maxReverseSpeed <= 0) errors.push(`${where} maxReverseSpeed must be positive`);
  if (def.drive.maxReverseSpeed > def.drive.maxSpeed) {
    errors.push(`${where} reverses faster than it drives forward`);
  }
  if (def.steering.maxAngle <= 0 || def.steering.maxAngle > Math.PI / 2) {
    errors.push(`${where} steering angle out of range`);
  }
  if (def.suspension.maxForce <= 0) errors.push(`${where} suspension force must be capped above zero`);
  if (def.suspension.restLength <= 0) errors.push(`${where} suspension rest length must be positive`);

  if (def.damage.dentSpeed <= def.damage.scratchSpeed) {
    errors.push(`${where} denting must need a harder hit than scratching`);
  }
  if (def.ownership.requiresKey && !def.ownership.keyItem) {
    errors.push(`${where} requires a key but names no key item`);
  }

  // LODs are chosen by walking the list; unordered distances would pick wrong.
  for (let i = 1; i < def.lods.length; i++) {
    if (def.lods[i].distance <= def.lods[i - 1].distance) {
      errors.push(`${where} LOD distances must increase`);
      break;
    }
  }

  return errors;
}

/** Pick the LOD suffix for a viewing distance. */
export function lodFor(def: VehicleDefinition, distance: number): string {
  let chosen = def.lods[0]?.suffix ?? '';
  for (const lod of def.lods) {
    if (distance >= lod.distance) chosen = lod.suffix;
  }
  return chosen;
}

/**
 * Steering limit at a given speed.
 *
 * Shrinking the lock as speed rises is the single biggest contributor to a
 * forgiving arcade feel: full lock at 25 m/s is a spin, and no amount of grip
 * tuning rescues it.
 */
export function steeringLimitAt(def: VehicleDefinition, speed: number): number {
  const { maxAngle, speedSensitivity } = def.steering;
  const top = Math.max(def.drive.maxSpeed, 0.001);
  const t = Math.min(1, Math.max(0, Math.abs(speed) / top));
  return maxAngle * (1 - speedSensitivity * t);
}

/** Sideways grip at a given speed, following the same falloff idea. */
export function gripAt(def: VehicleDefinition, speed: number): number {
  const { sideFriction, speedFalloff, lowSpeedBonus } = def.grip;
  const top = Math.max(def.drive.maxSpeed, 0.001);
  const t = Math.min(1, Math.max(0, Math.abs(speed) / top));
  const bonus = lowSpeedBonus * (1 - t);
  return sideFriction * (1 - speedFalloff * t) + bonus;
}

export const isTwoWheel = (def: VehicleDefinition): boolean => def.kind === 'twoWheel';
export const usesFuel = (def: VehicleDefinition): boolean => def.fuel !== null;

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

/** Cosmetic only, per the brief: no deformation model, just marks and repair. */
const carDamage: DamageSpec = {
  scratchSpeed: 4,
  dentSpeed: 9,
  impairedBelow: 0.35,
  repairCost: 120,
};

const carCamera: VehicleCameraSpec = {
  distance: 7.4,
  height: 2.9,
  pitch: 0.14,
  speedPullback: 2.2,
  reverseAssist: 0.55,
  stiffness: 6.5,
};

const bikeCamera: VehicleCameraSpec = {
  distance: 5.2,
  height: 2.1,
  pitch: 0.11,
  speedPullback: 1.4,
  reverseAssist: 0.3,
  stiffness: 7.5,
};

/** Four wheels laid out from a wheelbase and a track width. */
function fourWheels(halfTrack: number, halfBase: number, radius: number, y: number): WheelSpec[] {
  return [
    { id: 'fl', position: v(-halfTrack, y, halfBase), radius, width: 0.22, steered: true, powered: false, braked: true },
    { id: 'fr', position: v(halfTrack, y, halfBase), radius, width: 0.22, steered: true, powered: false, braked: true },
    // Rear-driven: the front wheels steer, the back ones push. Driving both
    // ends is more capable and much less readable when it lets go.
    { id: 'rl', position: v(-halfTrack, y, -halfBase), radius, width: 0.22, steered: false, powered: true, braked: true },
    { id: 'rr', position: v(halfTrack, y, -halfBase), radius, width: 0.22, steered: false, powered: true, braked: true },
  ];
}

function twoWheels(halfBase: number, radius: number, y: number): WheelSpec[] {
  return [
    { id: 'front', position: v(0, y, halfBase), radius, width: 0.1, steered: true, powered: false, braked: true },
    { id: 'rear', position: v(0, y, -halfBase), radius, width: 0.12, steered: false, powered: true, braked: true },
  ];
}

// ---------------------------------------------------------------------------
// The fleet
// ---------------------------------------------------------------------------

export const BICYCLE: VehicleDefinition = {
  id: 'bicycle',
  displayName: 'Bicycle',
  kind: 'twoWheel',
  propulsion: 'pedal',
  model: 'Bicycle',
  lods: [
    { distance: 0, suffix: '' },
    { distance: 28, suffix: '_LOD1' },
  ],
  collisionProxy: 'Bicycle_Col',
  colourVariants: ['#3f7f6f', '#b4553f', '#4a5a7a'],

  mass: 14,
  dimensions: v(0.6, 1.1, 1.75),
  centreOfMass: v(0, 0.42, -0.05),

  wheels: twoWheels(0.53, 0.34, -0.1),
  suspension: {
    restLength: 0.09, stiffness: 22, compression: 0.5, relaxation: 0.4,
    maxForce: 900, maxTravel: 0.06,
  },
  grip: { sideFriction: 1.5, speedFalloff: 0.2, lowSpeedBonus: 0.5 },
  drive: {
    maxSpeed: 7.2, maxReverseSpeed: 1.4, enginePower: 220, brakeForce: 380,
    engineBraking: 90, zeroToTopSeconds: 5.5,
  },
  steering: { maxAngle: 0.62, speedSensitivity: 0.55, rate: 4.0, returnRate: 5.0 },
  balance: {
    assistBelowSpeed: 3.2, uprightStrength: 26, uprightDamping: 7,
    maxRecoveryTorque: 55, maxLean: 0.42, fallAngle: 1.05, fallRecoverySeconds: 1.4,
  },
  handlebarSockets: [v(-0.26, 0.95, 0.36), v(0.26, 0.95, 0.36)],

  seats: [{
    id: 'saddle', role: 'driver', position: v(0, 0.92, -0.08),
    door: 'straddle', exitOffset: v(-0.75, 0, 0),
  }],
  camera: bikeCamera,
  lights: [
    { id: 'front', role: 'headlight', position: v(0, 0.72, 0.8), colour: '#fff3d0', intensity: 0.7 },
    { id: 'rear', role: 'brake', position: v(0, 0.62, -0.78), colour: '#ff4a3a', intensity: 0.5 },
  ],
  audio: { profile: 'pedal', idleHz: 0, maxHz: 120, hornHz: 1400, volume: 0.35 },

  damage: { scratchSpeed: 3, dentSpeed: 7, impairedBelow: 0.3, repairCost: 25 },
  ownership: {
    ownable: true, requiresKey: false, keyItem: null,
    lockable: true, impoundable: false, price: 120,
  },
  // Never. This is asserted in the tests, not just left null by habit.
  fuel: null,
  spawn: { zones: [], clearance: 1.1, requiresRoad: false, maxSlope: 0.45 },
};

export const SCOOTER: VehicleDefinition = {
  id: 'scooter',
  displayName: 'Scooter',
  kind: 'twoWheel',
  propulsion: 'engine',
  model: 'Scooter',
  lods: [
    { distance: 0, suffix: '' },
    { distance: 30, suffix: '_LOD1' },
  ],
  collisionProxy: 'Scooter_Col',
  colourVariants: ['#d8c15a', '#8a5a8f', '#3f6f8f'],

  mass: 96,
  dimensions: v(0.68, 1.2, 1.9),
  centreOfMass: v(0, 0.38, -0.06),

  wheels: twoWheels(0.58, 0.26, -0.14),
  suspension: {
    restLength: 0.12, stiffness: 30, compression: 0.6, relaxation: 0.45,
    maxForce: 3200, maxTravel: 0.09,
  },
  grip: { sideFriction: 1.9, speedFalloff: 0.25, lowSpeedBonus: 0.45 },
  drive: {
    maxSpeed: 13.5, maxReverseSpeed: 1.6, enginePower: 1500, brakeForce: 2100,
    engineBraking: 320, zeroToTopSeconds: 6.0,
  },
  steering: { maxAngle: 0.55, speedSensitivity: 0.62, rate: 3.6, returnRate: 4.6 },
  balance: {
    assistBelowSpeed: 4.0, uprightStrength: 90, uprightDamping: 22,
    maxRecoveryTorque: 240, maxLean: 0.46, fallAngle: 1.0, fallRecoverySeconds: 1.6,
  },
  handlebarSockets: [v(-0.3, 1.0, 0.42), v(0.3, 1.0, 0.42)],

  seats: [{
    id: 'saddle', role: 'driver', position: v(0, 0.86, -0.12),
    door: 'straddle', exitOffset: v(-0.8, 0, 0),
  }],
  camera: bikeCamera,
  lights: [
    { id: 'front', role: 'headlight', position: v(0, 0.86, 0.82), colour: '#fff3d0', intensity: 1.1 },
    { id: 'rear', role: 'brake', position: v(0, 0.66, -0.84), colour: '#ff4a3a', intensity: 0.6 },
  ],
  audio: { profile: 'smallEngine', idleHz: 42, maxHz: 210, hornHz: 1750, volume: 0.5 },

  damage: { scratchSpeed: 4, dentSpeed: 8, impairedBelow: 0.32, repairCost: 70 },
  ownership: {
    ownable: true, requiresKey: true, keyItem: 'keys_scooter',
    lockable: true, impoundable: true, price: 950,
  },
  fuel: { capacity: 5.5, consumptionPerKm: 0.022, refillCost: 9 },
  spawn: { zones: [], clearance: 1.3, requiresRoad: false, maxSlope: 0.38 },
};

export const HATCHBACK: VehicleDefinition = {
  id: 'hatchback',
  displayName: 'Hatchback',
  kind: 'fourWheel',
  propulsion: 'engine',
  model: 'Hatchback',
  lods: [
    { distance: 0, suffix: '' },
    { distance: 35, suffix: '_LOD1' },
    { distance: 80, suffix: '_LOD2' },
  ],
  collisionProxy: 'Hatchback_Col',
  colourVariants: ['#c94f3d', '#5a7fa8', '#e0dcc8', '#3f4a44'],

  mass: 1180,
  dimensions: v(1.72, 1.46, 3.9),
  centreOfMass: v(0, 0.42, -0.12),

  wheels: fourWheels(0.76, 1.24, 0.31, -0.24),
  suspension: {
    restLength: 0.34, stiffness: 26, compression: 0.62, relaxation: 0.48,
    maxForce: 22000, maxTravel: 0.22,
  },
  grip: { sideFriction: 2.4, speedFalloff: 0.28, lowSpeedBonus: 0.35 },
  drive: {
    maxSpeed: 24, maxReverseSpeed: 6.5, enginePower: 9200, brakeForce: 14000,
    engineBraking: 1400, zeroToTopSeconds: 9.5,
  },
  steering: { maxAngle: 0.52, speedSensitivity: 0.68, rate: 3.2, returnRate: 4.2 },
  balance: null,
  handlebarSockets: null,

  seats: [
    { id: 'driver', role: 'driver', position: v(-0.36, 0.62, 0.2), door: 'left', exitOffset: v(-1.25, 0, 0.2) },
    { id: 'front_passenger', role: 'passenger', position: v(0.36, 0.62, 0.2), door: 'right', exitOffset: v(1.25, 0, 0.2) },
    { id: 'rear_left', role: 'passenger', position: v(-0.38, 0.62, -0.75), door: 'left', exitOffset: v(-1.25, 0, -0.75) },
    { id: 'rear_right', role: 'passenger', position: v(0.38, 0.62, -0.75), door: 'right', exitOffset: v(1.25, 0, -0.75) },
  ],
  camera: carCamera,
  lights: [
    { id: 'head_l', role: 'headlight', position: v(-0.62, 0.66, 1.9), colour: '#fff3d0', intensity: 1.5 },
    { id: 'head_r', role: 'headlight', position: v(0.62, 0.66, 1.9), colour: '#fff3d0', intensity: 1.5 },
    { id: 'brake_l', role: 'brake', position: v(-0.64, 0.78, -1.92), colour: '#ff4a3a', intensity: 0.8 },
    { id: 'brake_r', role: 'brake', position: v(0.64, 0.78, -1.92), colour: '#ff4a3a', intensity: 0.8 },
    { id: 'reverse', role: 'reverse', position: v(0, 0.7, -1.94), colour: '#f4f4ec', intensity: 0.6 },
  ],
  audio: { profile: 'carEngine', idleHz: 34, maxHz: 165, hornHz: 420, volume: 0.55 },

  damage: carDamage,
  ownership: {
    ownable: true, requiresKey: true, keyItem: 'keys_hatchback',
    lockable: true, impoundable: true, price: 4200,
  },
  fuel: { capacity: 42, consumptionPerKm: 0.068, refillCost: 62 },
  spawn: { zones: [], clearance: 2.4, requiresRoad: true, maxSlope: 0.3 },
};

export const VAN: VehicleDefinition = {
  id: 'van',
  displayName: 'Delivery van',
  kind: 'fourWheel',
  propulsion: 'engine',
  model: 'Van',
  lods: [
    { distance: 0, suffix: '' },
    { distance: 38, suffix: '_LOD1' },
    { distance: 85, suffix: '_LOD2' },
  ],
  collisionProxy: 'Van_Col',
  colourVariants: ['#e6e2d4', '#5f7f6a', '#8a6a4a'],

  mass: 1950,
  dimensions: v(1.9, 2.24, 4.85),
  // Higher and further back than the hatchback: a van should lean in corners
  // and feel reluctant, without ever actually tipping.
  centreOfMass: v(0, 0.62, -0.2),

  wheels: fourWheels(0.82, 1.52, 0.35, -0.3),
  suspension: {
    restLength: 0.4, stiffness: 24, compression: 0.68, relaxation: 0.52,
    maxForce: 34000, maxTravel: 0.26,
  },
  grip: { sideFriction: 2.2, speedFalloff: 0.34, lowSpeedBonus: 0.3 },
  drive: {
    maxSpeed: 20, maxReverseSpeed: 5.5, enginePower: 12500, brakeForce: 19000,
    engineBraking: 2100, zeroToTopSeconds: 13,
  },
  steering: { maxAngle: 0.46, speedSensitivity: 0.7, rate: 2.6, returnRate: 3.6 },
  balance: null,
  handlebarSockets: null,

  seats: [
    { id: 'driver', role: 'driver', position: v(-0.4, 0.95, 1.0), door: 'left', exitOffset: v(-1.4, 0, 1.0) },
    { id: 'front_passenger', role: 'passenger', position: v(0.4, 0.95, 1.0), door: 'right', exitOffset: v(1.4, 0, 1.0) },
  ],
  camera: { ...carCamera, distance: 8.6, height: 3.4 },
  lights: [
    { id: 'head_l', role: 'headlight', position: v(-0.68, 0.86, 2.36), colour: '#fff3d0', intensity: 1.5 },
    { id: 'head_r', role: 'headlight', position: v(0.68, 0.86, 2.36), colour: '#fff3d0', intensity: 1.5 },
    { id: 'brake_l', role: 'brake', position: v(-0.7, 1.1, -2.4), colour: '#ff4a3a', intensity: 0.8 },
    { id: 'brake_r', role: 'brake', position: v(0.7, 1.1, -2.4), colour: '#ff4a3a', intensity: 0.8 },
    { id: 'reverse', role: 'reverse', position: v(0, 0.9, -2.42), colour: '#f4f4ec', intensity: 0.6 },
  ],
  audio: { profile: 'vanEngine', idleHz: 28, maxHz: 140, hornHz: 330, volume: 0.6 },

  damage: { ...carDamage, repairCost: 180 },
  ownership: {
    ownable: true, requiresKey: true, keyItem: 'keys_van',
    lockable: true, impoundable: true, price: 6800,
  },
  fuel: { capacity: 60, consumptionPerKm: 0.095, refillCost: 88 },
  spawn: { zones: [], clearance: 3.0, requiresRoad: true, maxSlope: 0.26 },
};

/**
 * The police car.
 *
 * A hatchback underneath, deliberately: Phase 9 wants a pursuit vehicle that
 * behaves like something the player already understands. It is quicker and
 * grippier, carries a beacon, and is not for sale — `ownable: false` is what
 * stops it turning up in the player's garage before there is any police AI to
 * take it away again.
 */
export const POLICE: VehicleDefinition = {
  ...HATCHBACK,
  id: 'police',
  displayName: 'Police car',
  model: 'Police',
  collisionProxy: 'Police_Col',
  colourVariants: ['#2b3550'],
  lods: [
    { distance: 0, suffix: '' },
    { distance: 35, suffix: '_LOD1' },
    { distance: 80, suffix: '_LOD2' },
  ],

  mass: 1290,
  drive: {
    maxSpeed: 28, maxReverseSpeed: 7.5, enginePower: 11800, brakeForce: 16500,
    engineBraking: 1500, zeroToTopSeconds: 8.0,
  },
  grip: { sideFriction: 2.7, speedFalloff: 0.24, lowSpeedBonus: 0.35 },

  lights: [
    ...HATCHBACK.lights,
    { id: 'beacon_l', role: 'beacon', position: v(-0.34, 1.5, 0.1), colour: '#3a6cff', intensity: 1.8 },
    { id: 'beacon_r', role: 'beacon', position: v(0.34, 1.5, 0.1), colour: '#ff3a3a', intensity: 1.8 },
  ],
  audio: { profile: 'carEngine', idleHz: 36, maxHz: 180, hornHz: 460, volume: 0.6 },

  ownership: {
    ownable: false, requiresKey: true, keyItem: 'keys_police',
    lockable: true, impoundable: false, price: null,
  },
  fuel: { capacity: 48, consumptionPerKm: 0.078, refillCost: 70 },
  spawn: { zones: [], clearance: 2.4, requiresRoad: true, maxSlope: 0.3 },
};

export const VEHICLES: readonly VehicleDefinition[] = [
  BICYCLE, SCOOTER, HATCHBACK, VAN, POLICE,
];

const BY_ID = new Map(VEHICLES.map((d) => [d.id, d]));

export function vehicleDef(id: VehicleId): VehicleDefinition | null {
  return BY_ID.get(id) ?? null;
}

/** Every definition's validation errors, keyed by id. Empty means the fleet is sound. */
export function validateFleet(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const def of VEHICLES) {
    const errors = validateDefinition(def);
    if (errors.length) out[def.id] = errors;
  }
  return out;
}
