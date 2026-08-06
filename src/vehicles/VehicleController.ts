import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import type { BodyId, PhysicsWorld } from '../physics/PhysicsWorld';
import type { VehicleDefinition } from './VehicleDefinition';
import { gripAt } from './VehicleDefinition';
import {
  NEUTRAL_INPUT,
  balanceTorque,
  conditionGripScale,
  leanFromUp,
  normaliseInput,
  resolveDrive,
  speedKmh,
  stepSteering,
  visualLean,
  type Gear,
  type VehicleInput,
} from './VehicleDynamics';

/**
 * One controller for every vehicle.
 *
 * Rapier's ray-cast vehicle controller does not insist on four wheels, so a
 * bicycle is a two-wheeled instance of the same thing rather than a parallel
 * implementation. What a two-wheeler needs *extra* is balance, and that is one
 * torque applied after the solver — not a second code path.
 *
 * That keeps the promise `VehicleDefinition` makes: a scooter and a van differ
 * in numbers, not in which code runs.
 *
 * Everything decided here is decided in `VehicleDynamics`, which is pure and
 * exhaustively tested. This file exists to talk to Rapier.
 */

export interface VehicleTelemetry {
  /** Along the vehicle's own forward axis. Negative means reversing. */
  readonly forwardSpeed: number;
  readonly speedKmh: number;
  readonly gear: Gear;
  readonly steerAngle: number;
  readonly wheelsOnGround: number;
  readonly grounded: boolean;
  /** Signed lean, radians. Always 0 for cars. */
  readonly lean: number;
  /** Two-wheelers only: past the fall angle. */
  readonly fallen: boolean;
  /** How long it has been down, seconds. */
  readonly fallenFor: number;
  /** Roughly upright, i.e. not on its roof. */
  readonly upright: boolean;
}

const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _vel = new THREE.Vector3();

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Angular inertia of a solid box, per axis.
 *
 * Rapier wants the eigenvalues of the inertia matrix, and leaving them to the
 * collider's density gives a vehicle that spins like a crate. A hatchback that
 * pirouettes off a kerb is a tuning problem you cannot solve with grip.
 */
function boxInertia(mass: number, d: { x: number; y: number; z: number }) {
  const k = mass / 12;
  return {
    x: k * (d.y * d.y + d.z * d.z),
    y: k * (d.x * d.x + d.z * d.z),
    z: k * (d.x * d.x + d.y * d.y),
  };
}

export class VehicleController {
  private readonly rapier: typeof RAPIER;
  private readonly body: RAPIER.RigidBody;
  private readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  readonly bodyId: BodyId;

  private input: VehicleInput = NEUTRAL_INPUT;
  private steerAngle = 0;
  private gear: Gear = 'neutral';
  private fallenSeconds = 0;
  private leanAngle = 0;
  private lastLean = 0;
  private lean = 0;
  private condition = 1;

  constructor(
    private readonly physics: PhysicsWorld,
    readonly def: VehicleDefinition,
    position: THREE.Vector3,
    facing: number,
  ) {
    this.rapier = physics.rapier;
    const world = physics.raw;
    const d = def.dimensions;

    const rot = _quat.setFromAxisAngle(UP, facing);
    const desc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      // Acceptance criterion: a car must not pass through an ordinary wall at
      // its top speed. At 28 m/s a vehicle moves ~0.47 m per step, further than
      // a wall is thick, so discrete collision alone would let it through.
      .setCcdEnabled(true)
      .setAdditionalMassProperties(
        def.mass,
        def.centreOfMass,
        boxInertia(def.mass, d),
        { x: 0, y: 0, z: 0, w: 1 },
      )
      .setLinearDamping(0.06)
      // Two-wheelers get more angular damping: it takes the twitch out of the
      // balance assist without weakening the correction itself.
      .setAngularDamping(def.kind === 'twoWheel' ? 0.9 : 0.4);

    this.body = world.createRigidBody(desc);

    const collider = this.rapier.ColliderDesc.cuboid(d.x / 2, d.y / 2, d.z / 2)
      // Density zero on purpose. `setAdditionalMassProperties` *adds* to
      // whatever the colliders contribute, so a collider with density would
      // silently make every vehicle heavier than its definition says.
      .setDensity(0)
      .setFriction(0.55)
      .setRestitution(0.04)
      .setTranslation(0, def.centreOfMass.y, 0);
    world.createCollider(collider, this.body);

    this.vehicle = world.createVehicleController(this.body);
    for (const wheel of def.wheels) {
      this.vehicle.addWheel(
        wheel.position,
        { x: 0, y: -1, z: 0 },   // suspension casts downward
        { x: -1, y: 0, z: 0 },   // axle across the vehicle
        def.suspension.restLength,
        wheel.radius,
      );
    }

    const s = def.suspension;
    for (let i = 0; i < def.wheels.length; i++) {
      this.vehicle.setWheelSuspensionStiffness(i, s.stiffness);
      this.vehicle.setWheelSuspensionCompression(i, s.compression);
      this.vehicle.setWheelSuspensionRelaxation(i, s.relaxation);
      this.vehicle.setWheelMaxSuspensionForce(i, s.maxForce);
      this.vehicle.setWheelMaxSuspensionTravel(i, s.maxTravel);
      this.vehicle.setWheelSideFrictionStiffness(i, def.grip.sideFriction);
    }

    this.bodyId = physics.track(this.body, { recovery: position.clone() });
  }

  setInput(raw: Partial<VehicleInput>): void {
    this.input = normaliseInput(raw);
  }

  /** 0..1. Damage is cosmetic, but a wreck should drive slightly worse. */
  setCondition(condition: number): void {
    this.condition = Math.min(1, Math.max(0, condition));
  }

  /** Forward speed along the vehicle's own axis; negative while reversing. */
  get forwardSpeed(): number {
    const r = this.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    _forward.copy(FORWARD).applyQuaternion(_quat);
    const v = this.body.linvel();
    _vel.set(v.x, v.y, v.z);
    return _vel.dot(_forward);
  }

  private get upVector(): THREE.Vector3 {
    const r = this.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    return _up.copy(UP).applyQuaternion(_quat);
  }

  get telemetry(): VehicleTelemetry {
    const speed = this.forwardSpeed;
    let onGround = 0;
    for (let i = 0; i < this.def.wheels.length; i++) {
      if (this.vehicle.wheelIsInContact(i)) onGround++;
    }
    return {
      forwardSpeed: speed,
      speedKmh: speedKmh(speed),
      gear: this.gear,
      steerAngle: this.steerAngle,
      wheelsOnGround: onGround,
      grounded: onGround > 0,
      lean: this.lean,
      fallen: this.fallenSeconds > 0,
      fallenFor: this.fallenSeconds,
      upright: this.upVector.y > 0.35,
    };
  }

  /** Cosmetic roll for the renderer. Cars return 0. */
  get visualLeanAngle(): number {
    return visualLean(this.def, this.steerAngle, this.forwardSpeed);
  }

  /**
   * One fixed step. Must be called *before* `PhysicsWorld.step`, so the forces
   * decided here are the ones the solver integrates this step rather than the
   * next one.
   */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    const def = this.def;
    const speed = this.forwardSpeed;

    this.steerAngle = stepSteering(def, this.steerAngle, this.input, speed, dt);
    const forces = resolveDrive(def, this.input, speed);
    this.gear = forces.gear;

    // Split evenly across the wheels that do each job, so a definition can
    // change which wheels drive without retuning the engine power.
    const powered = def.wheels.filter((w) => w.powered).length || 1;
    const braked = def.wheels.filter((w) => w.braked).length || 1;
    const grip = gripAt(def, speed) * conditionGripScale(def, this.condition);

    for (let i = 0; i < def.wheels.length; i++) {
      const wheel = def.wheels[i];
      this.vehicle.setWheelEngineForce(i, wheel.powered ? forces.engineForce / powered : 0);
      this.vehicle.setWheelBrake(i, wheel.braked ? forces.brakeForce / braked : 0);
      this.vehicle.setWheelSteering(i, wheel.steered ? this.steerAngle : 0);
      this.vehicle.setWheelSideFrictionStiffness(i, grip);
    }

    this.vehicle.updateVehicle(dt);

    if (def.kind === 'twoWheel') this.applyBalance(dt);
  }

  /**
   * Keep a two-wheeler up.
   *
   * Applied after `updateVehicle` because the suspension has to have run first
   * — correcting a lean the solver is about to change is how a bike ends up
   * wobbling at exactly the step frequency.
   */
  private applyBalance(dt: number): void {
    const up = this.upVector;
    this.lastLean = this.leanAngle;
    this.leanAngle = leanFromUp(up.x, up.y);
    this.lean = this.leanAngle;

    const rate = (this.leanAngle - this.lastLean) / dt;
    const result = balanceTorque(this.def, this.leanAngle, rate, this.forwardSpeed);

    if (result.fallen) {
      this.fallenSeconds += dt;
      // Down long enough: stand it back up rather than leave the player stuck
      // beside a bike they cannot use.
      if (this.fallenSeconds >= (this.def.balance?.fallRecoverySeconds ?? 1.5)) {
        this.rightItself();
      }
      return;
    }
    this.fallenSeconds = 0;

    // About the vehicle's own forward axis, so the correction rolls it upright
    // rather than steering it.
    const r = this.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    _forward.copy(FORWARD).applyQuaternion(_quat);

    const impulse = result.torque * dt;
    this.body.applyTorqueImpulse(
      { x: _forward.x * impulse, y: _forward.y * impulse, z: _forward.z * impulse },
      true,
    );
  }

  /**
   * Stand a fallen two-wheeler back up, in place.
   *
   * Keeps its heading and position: teleporting a bike to a road would be more
   * disruptive than the fall was. Velocity is dropped so it does not carry the
   * crash into the recovery.
   */
  rightItself(): void {
    const t = this.body.translation();
    const yaw = this.headingYaw();
    const q = _quat.setFromAxisAngle(UP, yaw);

    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setTranslation(
      { x: t.x, y: t.y + this.def.dimensions.y * 0.3, z: t.z },
      true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.fallenSeconds = 0;
    this.leanAngle = 0;
    this.lastLean = 0;
    this.lean = 0;
  }

  /** Current heading, ignoring pitch and roll. */
  headingYaw(): number {
    const r = this.body.rotation();
    _quat.set(r.x, r.y, r.z, r.w);
    _forward.copy(FORWARD).applyQuaternion(_quat);
    return Math.atan2(_forward.x, _forward.z);
  }

  /** Put the vehicle somewhere valid, upright and at rest. */
  resetTo(position: THREE.Vector3, facing: number): void {
    const q = _quat.setFromAxisAngle(UP, facing);
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.setRecoveryPoint(this.bodyId, position);
    this.steerAngle = 0;
    this.fallenSeconds = 0;
    this.lean = 0;
    this.leanAngle = 0;
    this.lastLean = 0;
    this.input = NEUTRAL_INPUT;
  }

  /** Interpolated transform for render. */
  sample(alpha: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): boolean {
    return this.physics.sample(this.bodyId, alpha, outPos, outQuat);
  }

  position(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  dispose(): void {
    this.physics.raw.removeVehicleController(this.vehicle);
    this.physics.untrack(this.bodyId);
  }
}
