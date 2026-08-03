import * as THREE from 'three';
import { clamp } from '../utils/MathUtils';
import { CollisionWorld, CapsuleResolveResult } from './CollisionWorld';

/**
 * Capsule character motor.
 *
 * Horizontal velocity is owned by the controller; this class integrates it,
 * applies gravity, pushes the capsule out of the BVH and reports grounding.
 *
 * Two details do most of the work in making it feel solid:
 *
 *  - Substepping caps how far the capsule can travel per resolve pass, so a
 *    sprinting jump cannot tunnel through a wall.
 *  - Ground snapping pulls the capsule back down when it crests a slope, so
 *    walking downhill doesn't produce a bunny-hop of tiny airborne frames.
 */

export interface MotorConfig {
  radius: number;
  height: number;
  gravity: number;
  /** Reduced downward force while in contact, m/s^2. */
  groundStick: number;
  maxSlopeDot: number;
  stepHeight: number;
  maxSubstep: number;
  terminalVelocity: number;
}

export const DEFAULT_MOTOR: MotorConfig = {
  radius: 0.30,
  height: 1.34,
  gravity: -21.5,
  groundStick: -3.2,
  // cos(50 deg): anything steeper is a wall, not a walkable slope
  maxSlopeDot: Math.cos(THREE.MathUtils.degToRad(50)),
  stepHeight: 0.42,
  maxSubstep: 0.22,
  terminalVelocity: -34,
};

export class CharacterMotor {
  /** World position of the soles. */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly groundNormal = new THREE.Vector3(0, 1, 0);

  grounded = false;
  /** Seconds since the character last touched the ground. */
  airTime = 0;
  /** Vertical speed at the moment of the most recent landing. */
  lastImpactSpeed = 0;
  justLanded = false;

  private readonly segment = new THREE.Line3();
  private readonly result: CapsuleResolveResult = {
    displacement: new THREE.Vector3(),
    groundNormal: null,
  };
  private readonly tmp = new THREE.Vector3();
  private readonly step = new THREE.Vector3();
  private readonly sweepFrom = new THREE.Vector3();
  private readonly sweepDir = new THREE.Vector3();

  constructor(public config: MotorConfig = { ...DEFAULT_MOTOR }) {}

  /**
   * Continuous guard against passing through thin geometry.
   *
   * Depenetration always pushes toward the *nearest* surface. If a single
   * step carries the capsule past the mid-plane of a wall, the nearest
   * surface is the far face — and the solver helpfully ejects the character
   * out the other side. Sweeping ahead and clamping the step to stop short of
   * the first hit removes that failure mode at any speed.
   *
   * Modifies `delta` in place.
   */
  private sweepClamp(world: CollisionWorld, delta: THREE.Vector3): void {
    const cfg = this.config;
    const dist = delta.length();
    if (dist < cfg.radius * 0.5 || !world.ready) return;

    this.sweepDir.copy(delta).divideScalar(dist);
    const probeHeights = [cfg.radius + 0.02, cfg.height * 0.5, cfg.height - cfg.radius - 0.02];

    let allowed = dist;
    for (const hy of probeHeights) {
      this.sweepFrom.set(this.position.x, this.position.y + hy, this.position.z);
      const hit = world.raycast(this.sweepFrom, this.sweepDir, dist + cfg.radius * 1.2);
      if (hit) allowed = Math.min(allowed, Math.max(0, hit.distance - cfg.radius * 1.05));
    }
    if (allowed < dist) delta.setLength(allowed);
  }

  get eyeHeight(): number {
    return this.config.height * 0.86;
  }

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.airTime = 0;
  }

  jump(speed: number): void {
    this.velocity.y = speed;
    this.grounded = false;
    this.airTime = 0;
  }

  private writeSegment(): void {
    const { radius, height } = this.config;
    this.segment.start.set(this.position.x, this.position.y + radius, this.position.z);
    this.segment.end.set(this.position.x, this.position.y + height - radius, this.position.z);
  }

  update(dt: number, world: CollisionWorld): void {
    this.justLanded = false;
    const cfg = this.config;

    // Split the frame so no single resolve pass moves further than
    // maxSubstep; that is what prevents tunnelling at run speed.
    const speed = this.velocity.length();
    const steps = clamp(Math.ceil((speed * dt) / cfg.maxSubstep), 1, 12);
    const h = dt / steps;

    const wasGrounded = this.grounded;

    for (let s = 0; s < steps; s++) {
      // While grounded, apply only a light hold-down force. Full gravity
      // drives the capsule a few millimetres into the slope every substep,
      // and the push-out that corrects it has a horizontal component — which
      // shows up as the character slowly sliding downhill while standing
      // still. A gentler force keeps contact without the creep.
      const g = this.grounded && this.velocity.y <= 0 ? cfg.groundStick : cfg.gravity;
      this.velocity.y = Math.max(cfg.terminalVelocity, this.velocity.y + g * h);

      this.step.copy(this.velocity).multiplyScalar(h);
      this.sweepClamp(world, this.step);
      this.position.add(this.step);

      this.writeSegment();
      world.resolveCapsule(this.segment, cfg.radius, this.result);

      const disp = this.result.displacement;
      if (disp.lengthSq() > 1e-12) {
        this.position.x = this.segment.start.x;
        this.position.z = this.segment.start.z;
        this.position.y = this.segment.start.y - cfg.radius;

        const n = this.result.groundNormal;
        if (n && n.y >= cfg.maxSlopeDot && this.velocity.y <= 0.001) {
          if (!wasGrounded && this.velocity.y < -1.5) {
            this.lastImpactSpeed = -this.velocity.y;
            this.justLanded = true;
          }
          this.grounded = true;
          this.groundNormal.copy(n);
          this.velocity.y = 0;
        } else if (n) {
          // Slide along walls and steep faces instead of sticking to them.
          this.tmp.copy(n).multiplyScalar(this.velocity.dot(n));
          if (this.tmp.dot(n) < 0) this.velocity.sub(this.tmp);
          if (n.y < cfg.maxSlopeDot) this.grounded = false;
        }
      } else {
        this.grounded = false;
      }
    }

    // Ground snap: crossing a convex crest leaves the capsule a few
    // centimetres airborne for a frame or two, which flickers the animation
    // state and stutters footsteps. Pull it back down if a surface is close.
    if (!this.grounded && wasGrounded && this.velocity.y <= 0.05) {
      const probeTop = this.position.y + cfg.radius * 0.5;
      const hitY = world.groundBelow(
        this.position.x,
        probeTop,
        this.position.z,
        cfg.stepHeight + cfg.radius,
      );
      if (hitY !== null && probeTop - hitY <= cfg.stepHeight + cfg.radius * 0.5) {
        this.position.y = hitY;
        this.velocity.y = 0;
        this.grounded = true;
        this.groundNormal.set(0, 1, 0);
      }
    }

    this.airTime = this.grounded ? 0 : this.airTime + dt;
  }

  /** Project a desired horizontal direction onto the current ground plane. */
  projectOnGround(v: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(v);
    if (!this.grounded) return out;
    const n = this.groundNormal;
    out.addScaledVector(n, -out.dot(n));
    const len = out.length();
    const src = Math.hypot(v.x, v.z);
    if (len > 1e-5 && src > 1e-5) out.multiplyScalar(src / len);
    return out;
  }
}
