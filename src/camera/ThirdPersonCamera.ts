import * as THREE from 'three';
import { InputManager } from '../core/InputManager';
import { CollisionWorld } from '../physics/CollisionWorld';
import { CameraCollision } from './CameraCollision';
import { clamp, damp, lerp } from '../utils/MathUtils';

/**
 * Spring-damped orbit camera.
 *
 * Two separate springs do the work: a fast one on the look-at target so the
 * character stays pinned in frame, and a slower one on the camera position so
 * motion feels weighty. Collision pulls in hard and eases back out — snapping
 * in is unnoticeable, snapping out is jarring.
 */

export interface CameraTuning {
  distance: number;
  minDistance: number;
  maxDistance: number;
  height: number;
  minPitch: number;
  maxPitch: number;
  yawSensitivity: number;
  pitchSensitivity: number;
  positionLambda: number;
  targetLambda: number;
  /** Faster than positionLambda, so obstacles never poke through. */
  collideInLambda: number;
  collideOutLambda: number;
  shoulderOffset: number;
}

export const DEFAULT_CAMERA: CameraTuning = {
  distance: 6.4,
  minDistance: 3.0,
  maxDistance: 11.0,
  height: 1.05,
  minPitch: -0.42,
  maxPitch: 1.05,
  yawSensitivity: 0.0042,
  pitchSensitivity: 0.0034,
  positionLambda: 11.0,
  targetLambda: 16.0,
  collideInLambda: 40.0,
  collideOutLambda: 5.0,
  shoulderOffset: 0.34,
};

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly tuning: CameraTuning = { ...DEFAULT_CAMERA };
  readonly collision = new CameraCollision();

  yaw = Math.PI;
  pitch = 0.20;

  private wantedDistance = DEFAULT_CAMERA.distance;
  private currentDistance = DEFAULT_CAMERA.distance;

  private readonly smoothTarget = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly offsetDir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  readonly forward = new THREE.Vector3(0, 0, -1);
  readonly right = new THREE.Vector3(1, 0, 0);

  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(56, aspect, 0.12, 1000);
    this.camera.position.set(0, 4, 10);
  }

  /** Narrower framing and a closer pull-in on tall, narrow screens. */
  applyViewport(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    const portrait = aspect < 0.82;
    this.camera.fov = portrait ? 68 : aspect < 1.35 ? 60 : 56;
    this.tuning.distance = portrait ? 5.2 : 6.4;
    this.tuning.height = portrait ? 0.95 : 1.05;
    this.wantedDistance = clamp(
      this.wantedDistance,
      this.tuning.minDistance,
      this.tuning.maxDistance,
    );
    this.camera.updateProjectionMatrix();
  }

  setDistance(d: number): void {
    this.wantedDistance = clamp(d, this.tuning.minDistance, this.tuning.maxDistance);
  }

  resetBehind(target: THREE.Vector3, facing: number): void {
    this.yaw = facing + Math.PI;
    this.pitch = 0.20;
    this.smoothTarget.copy(target);
    this.wantedDistance = this.tuning.distance;
    this.currentDistance = this.tuning.distance;
    this.initialised = false;
  }

  private applyLook(input: InputManager): void {
    const look = input.consumeLook();
    if (look.x || look.y) {
      this.yaw -= look.x * this.tuning.yawSensitivity;
      this.pitch = clamp(
        this.pitch + look.y * this.tuning.pitchSensitivity,
        this.tuning.minPitch,
        this.tuning.maxPitch,
      );
    }
    const zoom = input.consumeZoom();
    if (zoom) {
      this.wantedDistance = clamp(
        this.wantedDistance + zoom * 0.55,
        this.tuning.minDistance,
        this.tuning.maxDistance,
      );
    }
  }

  update(
    dt: number,
    target: THREE.Vector3,
    input: InputManager,
    world: CollisionWorld,
    scene: THREE.Object3D,
  ): void {
    this.applyLook(input);
    const t = this.tuning;

    // Drift the wanted distance back to the preset if a resize changed it.
    this.wantedDistance = lerp(this.wantedDistance, clamp(this.wantedDistance, t.minDistance, t.maxDistance), 0.5);

    if (!this.initialised) {
      this.smoothTarget.copy(target);
      this.initialised = true;
    } else {
      this.smoothTarget.lerp(target, damp(t.targetLambda, dt));
    }

    const cp = Math.cos(this.pitch);
    this.offsetDir.set(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch) + 0.16,
      Math.cos(this.yaw) * cp,
    ).normalize();

    // Slight shoulder bias keeps the character off dead centre.
    this.tmp.set(this.offsetDir.z, 0, -this.offsetDir.x).normalize();
    const anchor = this.desiredPos
      .copy(this.smoothTarget)
      .addScaledVector(this.tmp, t.shoulderOffset)
      .clone();
    anchor.y += t.height * 0.28;

    const available = this.collision.probeDistance(
      anchor,
      this.offsetDir,
      this.wantedDistance,
      world,
      this.camera.near * 2.4,
    );

    const lambda =
      available < this.currentDistance ? t.collideInLambda : t.collideOutLambda;
    this.currentDistance += (available - this.currentDistance) * damp(lambda, dt);

    this.desiredPos
      .copy(anchor)
      .addScaledVector(this.offsetDir, this.currentDistance);
    this.desiredPos.y += t.height * 0.42;

    this.camera.position.lerp(this.desiredPos, damp(t.positionLambda, dt));
    this.camera.lookAt(this.smoothTarget.x, this.smoothTarget.y + 0.12, this.smoothTarget.z);

    // Ground-plane basis handed to the controller for camera-relative motion.
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);

    this.collision.updateOcclusionFade(this.camera.position, target, scene, dt);
  }
}
