import type { Vec3Like } from '../nav/NavTypes';

/**
 * Arcade flight, and deliberately not a flight simulator.
 *
 * The brief rules out "a full aerodynamic simulator", and that is a design
 * constraint rather than a shortcut. A real six-degree-of-freedom model with
 * coefficient tables gives you a Cessna that a player without a yoke and forty
 * hours cannot land, in a game whose other vehicles are a bicycle and a
 * hatchback. What this wants is something that *reads* as flying: it climbs
 * when you pull, it banks into turns, it complains before it stalls, and it
 * can be put back on a runway by somebody who has never flown anything.
 *
 * So the model is a small set of honest lies:
 *
 *   - **Orientation is Euler, not a quaternion.** Pitch is clamped well short
 *     of vertical, so gimbal lock is unreachable, and yaw/pitch/roll are what
 *     the HUD, the camera and the tests all want to read anyway.
 *   - **Lift is a curve against airspeed, not an integral over a wing.** It
 *     cancels gravity at cruise, falls off below the stall speed, and that
 *     single fact produces every behaviour a player recognises — the sink in a
 *     tight turn, the nose drop when you get slow, the float in ground effect.
 *   - **Turning is banked yaw.** Roll produces yaw rate directly rather than
 *     through sideslip. It is what every arcade flyer does, and it is why a
 *     player can fly a circuit with two keys.
 *
 * Like `WeaponSystem`, `HeatSystem` and `TaskSystem` before it, this is
 * **clockless**: `advance(dt)` is the only way time enters, nothing here reads
 * a clock, touches THREE, or knows Rapier exists. A whole circuit is flown in
 * a millisecond in `tests/flight.test.ts`, which is the only reason takeoff
 * speed and stall recovery are testable at all.
 */

/** Which flight surfaces the player is asking for, all -1..1 except throttle. */
export interface FlightInput {
  /** Nose up positive. */
  pitch: number;
  /** Right wing down positive. */
  roll: number;
  /** Nose right positive. Also steers the nosewheel on the ground. */
  yaw: number;
  /** 0..1. */
  throttle: number;
  /** Wheel brakes. Only does anything on the ground. */
  brake: boolean;
}

export const NEUTRAL_INPUT: FlightInput = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0,
  brake: false,
};

/**
 * How much the game flies the aeroplane for you.
 *
 * `assisted` is the default and the brief says so. It is not "easy mode" — it
 * is the mode the game is balanced around, and `reduced` is the opt-in.
 */
export type AssistLevel = 'assisted' | 'reduced';

export interface FlightTuning {
  /** Newtons at full throttle, near enough. */
  readonly maxThrust: number;
  readonly mass: number;
  /** Airspeed at which the wing stops working, m/s. */
  readonly stallSpeed: number;
  /** Airspeed the wing wants. Lift exactly cancels weight here. */
  readonly cruiseSpeed: number;
  /** Never exceed. Drag rises steeply past it rather than a hard clamp. */
  readonly maxSpeed: number;
  /** Radians per second at full deflection. */
  readonly pitchRate: number;
  readonly rollRate: number;
  readonly yawRate: number;
  /** How hard bank turns the nose. Higher is twitchier. */
  readonly turnFromBank: number;
  /** Pitch is clamped to this, so the Euler model never approaches vertical. */
  readonly maxPitch: number;
  readonly maxRoll: number;
  /** Parasitic drag coefficient — the v^2 term. */
  readonly drag: number;
  /** Rolling resistance on the ground. */
  readonly rollingDrag: number;
  readonly brakeForce: number;
  /** Nosewheel steering rate on the ground, rad/s. */
  readonly groundSteer: number;
  /** Below this height above terrain the gear is considered down and touching. */
  readonly gearHeight: number;
  /** Vertical speed above which a touchdown is a crash rather than a landing. */
  readonly crashSinkRate: number;
  /** Bank or pitch beyond this on touchdown is also a crash. */
  readonly crashAttitude: number;
}

/*
 * Speeds are sized to the *world*, not to a real aeroplane.
 *
 * The five zones span roughly 512 x 432 m of actual content. At the first
 * tuning's 46 m/s cruise the aeroplane crossed all of it in eleven seconds and
 * left the flight corridor during its initial climb — the first in-game flight
 * was recovered at 52 m before it had finished taking off. That is not a
 * boundary bug; it is an aeroplane that does not fit its world.
 *
 * 34 m/s cruise gives about forty seconds corner to corner, which is a scenic
 * flight rather than a dash. The stall/cruise ratio is held at 2.0, so the
 * lift-curve arithmetic below still lands: 34 / sqrt(1 + 8.9 * 0.30) = 17.7,
 * just above the 17 m/s stall.
 */
export const PLANE_TUNING: FlightTuning = {
  // Unchanged when the speeds came down: thrust also has to overcome rolling
  // drag on the runway, and cutting it made the aeroplane too weak to taxi.
  maxThrust: 4200,
  mass: 780,
  stallSpeed: 17,
  cruiseSpeed: 34,
  maxSpeed: 56,
  pitchRate: 0.85,
  rollRate: 1.9,
  yawRate: 0.55,
  turnFromBank: 0.62,
  maxPitch: 0.95,
  maxRoll: 1.15,
  drag: 0.0016,
  rollingDrag: 0.9,
  brakeForce: 5200,
  groundSteer: 0.8,
  gearHeight: 1.25,
  crashSinkRate: 9.0,
  crashAttitude: 0.55,
};

export const GRAVITY = 9.81;

/** What the aeroplane is doing, for the HUD, the camera and the tests. */
export interface FlightState {
  readonly position: Vec3Like;
  readonly velocity: Vec3Like;
  /** Radians. Yaw 0 is +Z, matching the rest of the game. */
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly throttle: number;
  /** Speed along the flight path, m/s. */
  readonly airspeed: number;
  /** Positive is climbing, m/s. */
  readonly verticalSpeed: number;
  /** Metres above the terrain directly below. */
  readonly altitudeAgl: number;
  readonly onGround: boolean;
  readonly stalled: boolean;
  /** True while slow enough that the player should hear about it. */
  readonly stallWarning: boolean;
  readonly assist: AssistLevel;
  readonly propRadians: number;
}

/** Everything the model cannot know on its own. */
export interface FlightHost {
  /** Terrain height under a point. The model never raycasts. */
  groundAt(x: number, z: number): number;
}

export interface FlightSaveData {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  throttle: number;
  assist: AssistLevel;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Margin above the stall the warning starts at. 1.15 is ~5 kt in real units. */
const STALL_WARNING_MARGIN = 1.15;

/**
 * The lift curve, as three numbers that are not independent of each other.
 *
 * `CL_AT_LEVEL = 1` is the definition that makes level flight at `cruiseSpeed`
 * exactly cancel weight, which is why cruise speed means anything.
 *
 * `AOA_GAIN` and `MAX_AOA` then set the slowest speed the wing can hold the
 * aeroplane up at: solving `(v / cruise)^2 * (1 + gain * maxAoa) = 1` for
 * `cruiseSpeed = 34` gives 17.7 m/s, which is deliberately just above
 * `stallSpeed = 17`. Change any of the four and re-do that arithmetic, or the
 * aeroplane will either refuse to leave the runway or fly at a walking pace.
 */
const CL_AT_LEVEL = 1;
const AOA_GAIN = 8.9;
const MAX_AOA = 0.30;

/**
 * Structural load limit, in g. Caps lift however fast the aeroplane is going.
 * 3.5 is a light aircraft's utility-category limit and, more to the point, it
 * is the number that stops the wing becoming a rocket motor.
 */
const MAX_LOAD_G = 3.5;

/**
 * Assisted mode's pitch limit, radians.
 *
 * Tighter than the model's own `maxPitch`. Rate controls mean that holding a
 * gentle nose-down input for half a minute walks the attitude all the way to
 * the stop, and a player descending toward the airstrip does exactly that
 * without noticing. 0.45 rad is a 26 degree dive — steep enough to lose
 * height quickly, shallow enough to be recoverable.
 */
const ASSISTED_MAX_PITCH = 0.45;

/**
 * Nose-up held in a fully banked turn, radians.
 *
 * Scaled by `sin(roll)`, so wings level holds level. This is the back pressure
 * a pilot applies without noticing, and without it an assisted turn is a slow
 * descent that ends in the ground.
 */
const ASSIST_TURN_PITCH = 0.32;

/** Height above the wheels at which the assisted flare begins, metres. */
const FLARE_HEIGHT = 22;
/** Sink rate allowed entering the flare, and at the wheels. Both m/s. */
const FLARE_ENTRY_SINK = 6.0;
const FLARE_TOUCH_SINK = 1.4;
/** How briskly the flare takes hold. Higher is more obviously the game flying. */
const FLARE_AUTHORITY = 4.5;

export class FlightModel {
  private px = 0;
  private py = 0;
  private pz = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;

  private yawValue = 0;
  private pitchValue = 0;
  private rollValue = 0;

  private throttleValue = 0;
  private assistValue: AssistLevel = 'assisted';
  private onGroundValue = true;
  private stalledValue = false;
  private propValue = 0;

  constructor(
    private readonly host: FlightHost,
    private readonly tuning: FlightTuning = PLANE_TUNING,
  ) {}

  // -- reading --------------------------------------------------------------

  get airspeed(): number {
    return Math.hypot(this.vx, this.vy, this.vz);
  }

  get onGround(): boolean {
    return this.onGroundValue;
  }

  get stalled(): boolean {
    return this.stalledValue;
  }

  get assist(): AssistLevel {
    return this.assistValue;
  }

  get altitudeAgl(): number {
    return this.py - this.host.groundAt(this.px, this.pz);
  }

  setAssist(level: AssistLevel): void {
    this.assistValue = level;
  }

  state(): FlightState {
    const speed = this.airspeed;
    return {
      position: { x: this.px, y: this.py, z: this.pz },
      velocity: { x: this.vx, y: this.vy, z: this.vz },
      yaw: this.yawValue,
      pitch: this.pitchValue,
      roll: this.rollValue,
      throttle: this.throttleValue,
      airspeed: speed,
      verticalSpeed: this.vy,
      altitudeAgl: this.altitudeAgl,
      onGround: this.onGroundValue,
      stalled: this.stalledValue,
      stallWarning:
        !this.onGroundValue && speed < this.tuning.stallSpeed * STALL_WARNING_MARGIN,
      assist: this.assistValue,
      propRadians: this.propValue,
    };
  }

  /** Unit vector the nose points down. */
  forward(): Vec3Like {
    const cp = Math.cos(this.pitchValue);
    return {
      x: Math.sin(this.yawValue) * cp,
      y: Math.sin(this.pitchValue),
      z: Math.cos(this.yawValue) * cp,
    };
  }

  // -- placement ------------------------------------------------------------

  /**
   * Put the aeroplane somewhere, stopped and level.
   *
   * The one entry point for spawning, for the emergency reset and for a save
   * restore, so all three land in exactly the same state. A reset that left
   * residual roll would be a reset that sometimes did not work.
   */
  placeAt(x: number, z: number, yaw: number, aboveGround = 0): void {
    this.px = x;
    this.pz = z;
    this.py = this.host.groundAt(x, z) + this.tuning.gearHeight + aboveGround;
    this.yawValue = yaw;
    this.pitchValue = 0;
    this.rollValue = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.throttleValue = 0;
    this.stalledValue = false;
    this.onGroundValue = aboveGround <= 0.01;
  }

  /** Drop it into level flight at a height and speed. For tests and for cutscenes. */
  placeFlying(x: number, y: number, z: number, yaw: number, speed: number): void {
    this.px = x;
    this.py = y;
    this.pz = z;
    this.yawValue = yaw;
    this.pitchValue = 0;
    this.rollValue = 0;
    const f = this.forward();
    this.vx = f.x * speed;
    this.vy = 0;
    this.vz = f.z * speed;
    this.throttleValue = 0.7;
    this.stalledValue = false;
    this.onGroundValue = false;
  }

  // -- the frame ------------------------------------------------------------

  /**
   * One step.
   *
   * Order matters and is: throttle, then attitude, then forces, then
   * integrate, then ground. Ground last so a touchdown resolves against the
   * position the frame actually produced rather than the one before it —
   * getting that backwards lets a fast aeroplane tunnel through the runway.
   */
  advance(dt: number, input: FlightInput): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // A long step is split rather than trusted. A single advance(5) with a
    // 60 m/s aeroplane moves 300 m, which can cross a whole zone and miss the
    // ground entirely; the same failure `PhysicsWorld` guards against.
    const steps = Math.min(16, Math.ceil(dt / 0.05));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, input);
  }

  private step(dt: number, input: FlightInput): void {
    const t = this.tuning;

    this.throttleValue = clamp(input.throttle, 0, 1);
    const speed = this.airspeed;

    if (this.onGroundValue) this.groundAttitude(dt, input);
    else this.airAttitude(dt, input, speed);

    // -- forces, all in world space -----------------------------------------
    const f = this.forward();
    const thrust = t.maxThrust * this.throttleValue;

    let ax = (f.x * thrust) / t.mass;
    let ay = (f.y * thrust) / t.mass;
    let az = (f.z * thrust) / t.mass;

    ay -= GRAVITY;

    // Lift, computed whether or not the wheels are down.
    //
    // The first version only lifted when already airborne, which is a closed
    // loop with no way in: the wing produced nothing on the runway, so the
    // aeroplane never left it, so the wing never produced anything. The gear
    // constraint in `resolveGround` is what holds it down until lift wins, and
    // that is also how rotation comes to have a point.
    {
      const ratio = speed / t.cruiseSpeed;

      // Angle of attack — the *real* definition, pitch attitude minus flight
      // path angle, not pitch against the horizon.
      //
      // This is the one place the model refuses to simplify, because the
      // simplification does not work. Measuring angle of attack against the
      // horizon means a level aeroplane at 77 m/s still generates 2.8 g of
      // lift and balloons; the first in-game flight climbed 560 m in ten
      // seconds and hit the ceiling. Against the *flight path* it trims
      // itself: as the aeroplane climbs its path angle rises toward its pitch
      // attitude, the angle of attack falls, lift drops, and it settles into a
      // steady climb — which is what a real wing does and costs one `atan2`.
      const horizontal = Math.hypot(this.vx, this.vz);
      const pathAngle = speed > 1 ? Math.atan2(this.vy, Math.max(horizontal, 0.01)) : 0;
      const aoa = clamp(this.pitchValue - pathAngle, -0.15, MAX_AOA);
      const cl = CL_AT_LEVEL + AOA_GAIN * aoa;

      // Below the stall the wing stops working decisively rather than fading,
      // so the break is something a player feels.
      const stallRatio = speed / t.stallSpeed;
      const lifting = stallRatio >= 1 ? 1 : Math.max(0.25, stallRatio * stallRatio);
      this.stalledValue = !this.onGroundValue && stallRatio < 1;

      // Lift acts along the airframe's up. Bank therefore tilts it sideways,
      // which is what turns the aeroplane — and what makes a hard turn lose
      // height, with no extra code anywhere.
      const cy = Math.cos(this.yawValue);
      const sy = Math.sin(this.yawValue);
      const cp = Math.cos(this.pitchValue);
      const sp = Math.sin(this.pitchValue);
      const cr = Math.cos(this.rollValue);
      const sr = Math.sin(this.rollValue);

      const ux = -sy * sp * cr + cy * sr;
      const uy = cp * cr;
      const uz = -cy * sp * cr - sy * sr;

      // Load limit.
      //
      // `ratio * ratio` has no upper bound, so a fast aeroplane holding a high
      // angle produced ten g and climbed at 40 m/s indefinitely — a rocket,
      // not an aeroplane. A real wing is limited by what the airframe will
      // take and by the fact that you cannot hold that angle at that speed;
      // one cap stands in for both, and it is the difference between a flight
      // model and a launch.
      const lift = Math.min(
        GRAVITY * ratio * ratio * cl * lifting,
        GRAVITY * MAX_LOAD_G,
      );
      ax += ux * lift;
      ay += uy * lift;
      az += uz * lift;
    }

    // Drag, always opposing velocity.
    if (speed > 0.01) {
      const d = t.drag * speed * speed + (this.onGroundValue ? t.rollingDrag : 0);
      const brake = this.onGroundValue && input.brake ? t.brakeForce / t.mass : 0;
      const decel = (d + brake) / Math.max(speed, 0.01);
      ax -= this.vx * decel;
      ay -= this.vy * decel;
      az -= this.vz * decel;
    }

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.vz += az * dt;

    this.assistFlare(dt);

    // Never-exceed, as a soft ceiling rather than a clamp: a clamp reads as
    // hitting a wall, and this reads as running out of aeroplane.
    const after = this.airspeed;
    if (after > t.maxSpeed) {
      const k = 1 - Math.min(0.6, (after - t.maxSpeed) * 0.02) * dt * 60;
      const s = Math.max(0.9, k);
      this.vx *= s;
      this.vy *= s;
      this.vz *= s;
    }

    this.px += this.vx * dt;
    this.py += this.vy * dt;
    this.pz += this.vz * dt;

    this.propValue = (this.propValue + (6 + this.throttleValue * 130) * dt) % (Math.PI * 2);

    this.resolveGround(dt, input);
  }

  /**
   * The auto-flare, and the reason assisted mode is *forgiving* rather than
   * merely stable.
   *
   * Everything above this holds together as a flight model, and a player who
   * flies a perfect approach lands beautifully. The first version of the
   * circuit test proved that is not enough: arriving at 30 m/s with the nose
   * a few degrees down produces less than a fifth of the lift needed to hold
   * the aeroplane up, so it drops, and the touchdown is a crash. That is
   * correct physics and a bad game.
   *
   * So in assisted mode the sink rate is capped near the ground, and the cap
   * tightens as the wheels get closer. It is the flare a pilot would fly,
   * flown for you. It does nothing above `FLARE_HEIGHT`, nothing when
   * climbing, and nothing at all in reduced assist — where arriving badly is
   * the point.
   */
  private assistFlare(dt: number): void {
    if (this.assistValue !== 'assisted') return;
    if (this.onGroundValue || this.vy >= 0) return;

    const agl = this.altitudeAgl - this.tuning.gearHeight;
    if (agl > FLARE_HEIGHT || agl < -1) return;

    // 0 at the top of the flare, 1 at the wheels.
    const k = clamp(1 - agl / FLARE_HEIGHT, 0, 1);
    const cap = -(FLARE_ENTRY_SINK * (1 - k) + FLARE_TOUCH_SINK * k);
    if (this.vy < cap) {
      this.vy += (cap - this.vy) * Math.min(1, FLARE_AUTHORITY * dt);
    }
  }

  /**
   * On the runway: no roll, no pitch authority, the nosewheel steers.
   *
   * Below taxi speed the nosewheel still works, which is what lets a player
   * turn around at the end of the strip instead of being stuck pointing at a
   * fence.
   */
  private groundAttitude(dt: number, input: FlightInput): void {
    const t = this.tuning;
    const speed = this.airspeed;
    // Steering authority falls off with speed so a fast rollout is not a
    // pirouette, but never reaches zero.
    const authority = 0.35 + 0.65 / (1 + speed * 0.08);
    this.yawValue += input.yaw * t.groundSteer * authority * dt;

    // Rotation: the nose comes up once there is enough air over the tail.
    const canRotate = speed > t.stallSpeed * 0.82;
    const wantPitch = canRotate ? input.pitch : Math.min(0, input.pitch);
    this.pitchValue = clamp(
      this.pitchValue + wantPitch * t.pitchRate * dt,
      0,
      canRotate ? 0.28 : 0,
    );
    // Wings stay level on the ground. A rolled aeroplane on its wheels is a
    // crashed one, and the gear model has no way to express that.
    this.rollValue *= Math.max(0, 1 - 8 * dt);
  }

  /** In the air: full three-axis, with the assist level deciding how much help. */
  private airAttitude(dt: number, input: FlightInput, speed: number): void {
    const t = this.tuning;
    const assisted = this.assistValue === 'assisted';

    // Control authority scales with airspeed. A stalled aeroplane's controls
    // going soft is the single most important cue that something is wrong.
    const q = clamp(speed / t.cruiseSpeed, 0.15, 1.4);

    this.rollValue = clamp(
      this.rollValue + input.roll * t.rollRate * q * dt,
      -t.maxRoll,
      t.maxRoll,
    );
    this.pitchValue = clamp(
      this.pitchValue + input.pitch * t.pitchRate * q * dt,
      -t.maxPitch,
      t.maxPitch,
    );
    this.yawValue += input.yaw * t.yawRate * q * dt;

    // Bank turns the nose. This is the arcade substitution for sideslip and
    // it is why a circuit can be flown with two keys.
    this.yawValue += Math.sin(this.rollValue) * t.turnFromBank * q * dt;

    if (assisted) {
      // Hands-off returns to wings level and a shallow climb attitude. Only
      // when the player is not asking for anything, so it never fights them.
      if (Math.abs(input.roll) < 0.05) {
        this.rollValue *= Math.max(0, 1 - 1.8 * dt);
      }
      // Hands off pitch, the aeroplane trims itself — but to a *turn
      // compensating* attitude, not to level.
      //
      // Banking tilts lift sideways, so a level-pitch turn loses height: that
      // is real, and it is why the first circuit test flew a beautiful climb
      // and then descended 116 m into the ground during a twenty-six second
      // turn, stalling on the way. A pilot answers a bank with back pressure
      // without thinking about it. Assisted mode does it for you, in
      // proportion to how far over the aeroplane is.
      if (Math.abs(input.pitch) < 0.05) {
        const hold = ASSIST_TURN_PITCH * Math.abs(Math.sin(this.rollValue));
        this.pitchValue += (hold - this.pitchValue) * Math.min(1, 1.4 * dt);
      }
      // Stall protection: below the warning speed the nose is pushed down
      // rather than the player being punished for holding back pressure.
      // This is what makes "assisted" a mode a beginner can fly a circuit in.
      if (speed < t.stallSpeed * STALL_WARNING_MARGIN && this.pitchValue > 0) {
        this.pitchValue = Math.max(0, this.pitchValue - 1.1 * dt);
      }
      // And bank and pitch limits, so an assisted player cannot spiral or
      // walk the nose to the stop by leaning on the stick for half a minute.
      this.rollValue = clamp(this.rollValue, -0.85, 0.85);
      this.pitchValue = clamp(this.pitchValue, -ASSISTED_MAX_PITCH, ASSISTED_MAX_PITCH);
    } else {
      // Reduced assist keeps only the two things that are frustration rather
      // than challenge: pitch stays clamped short of vertical (the Euler model
      // requires it) and there is a very weak roll damping, the way a real
      // aeroplane with dihedral has.
      if (Math.abs(input.roll) < 0.05) {
        this.rollValue *= Math.max(0, 1 - 0.35 * dt);
      }
    }
  }

  /**
   * Touchdown, taxi, or a crash.
   *
   * Returns nothing and decides nothing about consequences — it sets
   * `onGround` and, when the arrival was too hard, leaves `crashed` true for
   * the host to act on. Keeping the *judgement* here and the *response* in the
   * host is the same split `CombatDirector` uses for arrest.
   */
  private crashedValue = false;

  get crashed(): boolean {
    return this.crashedValue;
  }

  clearCrash(): void {
    this.crashedValue = false;
  }

  private resolveGround(dt: number, input: FlightInput): void {
    void dt;
    void input;
    const t = this.tuning;
    const ground = this.host.groundAt(this.px, this.pz);
    const wheelY = ground + t.gearHeight;

    if (this.py > wheelY + 0.02) {
      // Airborne. One-way: leaving the ground needs real climb rate, so a
      // bumpy taxi does not flicker between states.
      if (this.onGroundValue && this.vy > 0.4) this.onGroundValue = false;
      if (!this.onGroundValue) return;
    }

    // At or below the wheels.
    const sink = -this.vy;
    const wasAirborne = !this.onGroundValue;

    this.py = wheelY;
    if (this.vy < 0) this.vy = 0;

    if (wasAirborne) {
      const tooHard = sink > t.crashSinkRate;
      // Nose-down beyond the limit is a crash; nose-*up* is a tail strike at
      // worst and the gear model has no opinion about it. An earlier version
      // wrote `Math.abs(pitch) < -crashAttitude`, which is never true, so
      // arriving vertically was fine as long as it was slow.
      const tooCrooked =
        Math.abs(this.rollValue) > t.crashAttitude ||
        this.pitchValue < -t.crashAttitude;
      if (tooHard || tooCrooked) {
        this.crashedValue = true;
        this.vx *= 0.2;
        this.vz *= 0.2;
      }
      this.onGroundValue = true;
    }

    this.pitchValue = Math.max(0, Math.min(this.pitchValue, 0.28));
  }

  // -- persistence ----------------------------------------------------------

  toJSON(): FlightSaveData {
    return {
      x: this.px,
      y: this.py,
      z: this.pz,
      yaw: this.yawValue,
      pitch: this.pitchValue,
      roll: this.rollValue,
      vx: this.vx,
      vy: this.vy,
      vz: this.vz,
      throttle: this.throttleValue,
      assist: this.assistValue,
    };
  }

  /**
   * Restore, defensively.
   *
   * Every number is checked, because a save is untrusted input and a NaN in
   * the position propagates into the camera, the streaming query and the
   * terrain lookup within one frame. Phase 7 learned this with the economy.
   */
  restore(data: Partial<FlightSaveData> | undefined): void {
    const n = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;

    this.px = n(data?.x, 0);
    this.py = n(data?.y, 0);
    this.pz = n(data?.z, 0);
    this.yawValue = n(data?.yaw, 0);
    this.pitchValue = clamp(n(data?.pitch, 0), -this.tuning.maxPitch, this.tuning.maxPitch);
    this.rollValue = clamp(n(data?.roll, 0), -this.tuning.maxRoll, this.tuning.maxRoll);
    this.vx = n(data?.vx, 0);
    this.vy = n(data?.vy, 0);
    this.vz = n(data?.vz, 0);
    this.throttleValue = clamp(n(data?.throttle, 0), 0, 1);
    this.assistValue = data?.assist === 'reduced' ? 'reduced' : 'assisted';
    this.crashedValue = false;
    this.onGroundValue = this.altitudeAgl <= this.tuning.gearHeight + 0.05;
  }
}
