import * as THREE from 'three';
import { InputManager } from '../core/InputManager';
import { CharacterMotor } from '../physics/CharacterMotor';
import { CollisionWorld } from '../physics/CollisionWorld';
import { damp, dampAngle, clamp } from '../utils/MathUtils';

/**
 * Turns input plus a camera basis into motion.
 *
 * Acceleration is asymmetric — quick to start, quicker to stop — which reads
 * as responsive without feeling twitchy. Coyote time and a jump buffer cover
 * the two classic frustrations: jumping a moment after walking off an edge,
 * and pressing jump a moment before landing.
 */

export interface ControllerTuning {
  walkSpeed: number;
  runSpeed: number;
  acceleration: number;
  deceleration: number;
  airControl: number;
  turnLambda: number;
  jumpSpeed: number;
  coyoteTime: number;
  jumpBuffer: number;
  /** Fall below this Y and the player is put back on the road. */
  killPlaneY: number;
}

export const DEFAULT_TUNING: ControllerTuning = {
  walkSpeed: 1.62,
  runSpeed: 4.05,
  acceleration: 15.0,
  deceleration: 19.0,
  airControl: 4.2,
  turnLambda: 13.0,
  jumpSpeed: 6.35,
  coyoteTime: 0.13,
  jumpBuffer: 0.16,
  killPlaneY: -25,
};

export class PlayerController {
  readonly tuning: ControllerTuning = { ...DEFAULT_TUNING };

  /** Facing angle of the model, radians about +Y. */
  facing = 0;
  /** True for exactly the frame a jump starts. */
  jumpedThisFrame = false;
  /** True for the frame after a respawn. */
  respawnedThisFrame = false;
  /** Off while the player is in the interior cell, which sits off-map. */
  boundsEnabled = true;

  private timeSinceGrounded = Infinity;
  private jumpBufferedFor = Infinity;
  private readonly desired = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly planar = new THREE.Vector3();

  private spawn = new THREE.Vector3();

  constructor(
    readonly motor: CharacterMotor,
    private readonly input: InputManager,
  ) {}

  setSpawn(p: THREE.Vector3, facing = 0): void {
    this.spawn.copy(p);
    this.facing = facing;
    this.motor.teleport(p.x, p.y, p.z);
  }

  respawn(): void {
    this.motor.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
    this.timeSinceGrounded = Infinity;
    this.jumpBufferedFor = Infinity;
    this.respawnedThisFrame = true;
  }

  get planarSpeed(): number {
    return Math.hypot(this.motor.velocity.x, this.motor.velocity.z);
  }

  /**
   * @param camForward  camera forward flattened onto the ground plane
   * @param camRight    camera right, likewise
   */
  update(
    dt: number,
    world: CollisionWorld,
    camForward: THREE.Vector3,
    camRight: THREE.Vector3,
    inBounds: (x: number, z: number) => boolean,
  ): void {
    this.jumpedThisFrame = false;
    this.respawnedThisFrame = false;

    const t = this.tuning;
    const motor = this.motor;

    this.forward.copy(camForward).setY(0).normalize();
    this.right.copy(camRight).setY(0).normalize();

    const mv = this.input.move;
    this.desired
      .set(0, 0, 0)
      .addScaledVector(this.forward, mv.y)
      .addScaledVector(this.right, mv.x);

    const inputMag = clamp(this.desired.length(), 0, 1);
    if (inputMag > 1e-4) this.desired.normalize();

    const targetSpeed = (this.input.running ? t.runSpeed : t.walkSpeed) * inputMag;
    const targetVel = this.desired.multiplyScalar(targetSpeed);

    // Acceleration toward the target, with reduced authority in the air.
    const accelerating = targetSpeed > 0.01;
    const base = accelerating ? t.acceleration : t.deceleration;
    const lambda = motor.grounded ? base : t.airControl;
    const k = damp(lambda, dt);
    motor.velocity.x += (targetVel.x - motor.velocity.x) * k;
    motor.velocity.z += (targetVel.z - motor.velocity.z) * k;

    // Jump: buffered press + coyote grace.
    if (this.input.consumeJump()) this.jumpBufferedFor = 0;
    else this.jumpBufferedFor += dt;
    this.timeSinceGrounded = motor.grounded ? 0 : this.timeSinceGrounded + dt;

    if (
      this.jumpBufferedFor <= t.jumpBuffer &&
      this.timeSinceGrounded <= t.coyoteTime &&
      motor.velocity.y <= 0.5
    ) {
      motor.jump(t.jumpSpeed);
      this.jumpedThisFrame = true;
      this.jumpBufferedFor = Infinity;
      this.timeSinceGrounded = Infinity;
    }

    motor.update(dt, world);

    // Face the direction of travel, not the camera — the model should lead
    // the turn rather than strafe.
    this.planar.set(motor.velocity.x, 0, motor.velocity.z);
    if (this.planar.lengthSq() > 0.09) {
      const target = Math.atan2(this.planar.x, this.planar.z);
      this.facing = dampAngle(this.facing, target, t.turnLambda, dt);
    }

    if (
      this.boundsEnabled &&
      (motor.position.y < t.killPlaneY || !inBounds(motor.position.x, motor.position.z))
    ) {
      this.respawn();
    }
  }
}
