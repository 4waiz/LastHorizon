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
  /** Boom length while aiming. Short enough to see past the character. */
  aimDistance: number;
  /** How far the shoulder bias grows while aiming, so the reticle sits clear. */
  aimShoulderOffset: number;
  /**
   * Look speed multiplier while aiming.
   *
   * Below 1 on purpose. The same wrist movement covers the same *angle* either
   * way, but aiming narrows the field of view, so at equal sensitivity the
   * reticle appears to travel further — which reads as the camera speeding up
   * at exactly the moment the player wants it slower.
   */
  aimSensitivity: number;
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
  aimDistance: 2.35,
  aimShoulderOffset: 0.72,
  aimSensitivity: 0.55,
};

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly tuning: CameraTuning = { ...DEFAULT_CAMERA };
  readonly collision = new CameraCollision();

  yaw = Math.PI;
  pitch = 0.20;

  private wantedDistance = DEFAULT_CAMERA.distance;
  private currentDistance = DEFAULT_CAMERA.distance;

  /** Phase 9. Off for every player who never draws anything. */
  private aiming = false;
  /** +1 right shoulder, -1 left. Swapped by a key or a stick click. */
  private shoulder = 1;
  /** Eased 0..1, so entering and leaving aim is a move rather than a cut. */
  private aimBlend = 0;

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
    // Snap rather than ease: this is only called on teleports, where easing
    // would drag the camera through a wall on the way to its new spot.
    this.currentDistance = this.wantedDistance;
  }

  /**
   * Indoors the boom has to be able to collapse much further than it does
   * outdoors — a 7 m room cannot hold a 6 m camera arm.
   */
  setMinDistance(d: number): void {
    this.tuning.minDistance = d;
    this.wantedDistance = clamp(this.wantedDistance, d, this.tuning.maxDistance);
  }

  /**
   * Aim mode: shorter boom, wider shoulder bias, slower look.
   *
   * The zoom the *player* asked for is deliberately not touched, so releasing
   * the trigger returns to whatever framing they had chosen rather than to the
   * preset. `aimBlend` does the easing, so this is safe to call every frame.
   */
  setAiming(on: boolean): void {
    this.aiming = on;
  }

  get isAiming(): boolean {
    return this.aiming;
  }

  /** Over the other shoulder. Matters when the cover is on the wrong side. */
  swapShoulder(): void {
    this.shoulder = -this.shoulder;
  }

  get shoulderSide(): 1 | -1 {
    return this.shoulder > 0 ? 1 : -1;
  }

  resetBehind(target: THREE.Vector3, facing: number): void {
    this.yaw = facing + Math.PI;
    this.pitch = 0.20;
    this.smoothTarget.copy(target);
    this.wantedDistance = this.tuning.distance;
    this.currentDistance = this.tuning.distance;
    this.initialised = false;
  }

  /**
   * Put the camera exactly here, looking exactly there.
   *
   * For cutscenes, and deliberately outside `update`: a scene sets the camera
   * every frame and calls no springs, because a spring between two shots
   * smears the cut, and the cut is the only bit of grammar a scene has.
   *
   * `initialised` is cleared so that when the scene ends and `update` resumes,
   * the look-at target snaps to the player rather than easing there from
   * wherever the last shot was pointing.
   */
  placeAt(at: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }): void {
    this.camera.position.set(at.x, at.y, at.z);
    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    this.smoothTarget.set(lookAt.x, lookAt.y, lookAt.z);
    this.initialised = false;

    // The controller reads these for camera-relative movement; leaving them
    // pointing where a cutscene left them would make the first step after a
    // scene go sideways.
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
  }

  private applyLook(input: InputManager): void {
    const look = input.consumeLook();
    // Blended rather than switched, so sensitivity does not jump mid-turn on
    // the frame the trigger goes down.
    const sens = lerp(1, this.tuning.aimSensitivity, this.aimBlend);
    if (look.x || look.y) {
      this.yaw -= look.x * this.tuning.yawSensitivity * sens;
      this.pitch = clamp(
        this.pitch + look.y * this.tuning.pitchSensitivity * sens,
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
    // Blend before the look, so the first aiming frame already reads as
    // aiming — otherwise the sensitivity change lags the camera move by one.
    this.aimBlend += ((this.aiming ? 1 : 0) - this.aimBlend) * damp(9, dt);
    this.applyLook(input);
    const t = this.tuning;

    // Drift the wanted distance back to the preset if a resize changed it.
    this.wantedDistance = lerp(this.wantedDistance, clamp(this.wantedDistance, t.minDistance, t.maxDistance), 0.5);
    // Aiming overrides the player's zoom for as long as it lasts; it does not
    // overwrite it, so releasing returns to the framing they chose.
    const boom = lerp(this.wantedDistance, t.aimDistance, this.aimBlend);

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

    // Slight shoulder bias keeps the character off dead centre; aiming widens
    // it so the reticle is not looking through the back of their head. The
    // sign is the shoulder the player has chosen.
    this.tmp.set(this.offsetDir.z, 0, -this.offsetDir.x).normalize();
    const bias = lerp(t.shoulderOffset, t.aimShoulderOffset, this.aimBlend) * this.shoulder;
    const anchor = this.desiredPos
      .copy(this.smoothTarget)
      .addScaledVector(this.tmp, bias)
      .clone();
    anchor.y += t.height * 0.28;

    // The same probe either way. Pulling the boom in to 2.35 m does not excuse
    // the camera from a wall — a short arm clips a doorframe as happily as a
    // long one, and this is the only thing that stops it.
    const available = this.collision.probeDistance(
      anchor,
      this.offsetDir,
      boom,
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

    /*
     * Where the camera looks, which is not always where the player is.
     *
     * In ordinary play it looks straight at them and the shoulder bias is a
     * parallax nudge — the camera stands slightly to one side and still
     * converges on the character, so they stay centred. That is the framing
     * this game has had since Phase 1 and it is the right one for walking
     * around.
     *
     * Aiming needs the opposite. If the look-at converges, the character stays
     * dead centre and the reticle sits on the back of their head, which is
     * exactly what the first browser screenshot showed. So the target slides
     * sideways by the same bias as the camera did, the two lines become
     * parallel, and the character moves off to the chosen shoulder leaving the
     * reticle looking at the world. Blended, so nothing changes at rest.
     */
    this.tmp.multiplyScalar(bias * this.aimBlend);
    this.camera.lookAt(
      this.smoothTarget.x + this.tmp.x,
      this.smoothTarget.y + 0.12,
      this.smoothTarget.z + this.tmp.z,
    );

    // Ground-plane basis handed to the controller for camera-relative motion.
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);

    this.collision.updateOcclusionFade(this.camera.position, target, scene, dt);
  }
}
