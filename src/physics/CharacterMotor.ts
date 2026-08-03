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
  maxSlopeDot: number;
  stepHeight: number;
  maxSubstep: number;
  terminalVelocity: number;
}

export const DEFAULT_MOTOR: MotorConfig = {
  radius: 0.30,
  height: 1.34,
  gravity: -21.5,
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

  constructor(public config: MotorConfig = { ...DEFAULT_MOTOR }) {}

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
    const steps = clamp(Math.ceil((speed * dt) / cfg.maxSubstep), 1, 6);
    const h = dt / steps;

    const wasGrounded = this.grounded;

    for (let s = 0; s < steps; s++) {
      this.velocity.y = Math.max(cfg.terminalVelocity, this.velocity.y + cfg.gravity * h);
      this.position.addScaledVector(this.velocity, h);

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
