import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { ToonMaterial } from '../graphics/ToonMaterial';
import { clamp, damp } from '../utils/MathUtils';

/**
 * Keeps the camera out of geometry, and dithers away thin props that would
 * otherwise hide the character.
 *
 * The distance probe is a cheap five-ray approximation of a sphere cast: one
 * down the centre plus four offset by the near-plane corners. That is enough
 * to stop the near plane clipping a wall without the cost of a real sweep.
 */

const PROBE_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export class CameraCollision {
  /** Extra clearance kept between the camera and whatever it hit. */
  padding = 0.34;

  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();

  /** Materials currently faded, mapped to their target fade value. */
  private faded = new Map<ToonMaterial, number>();
  private hitList: THREE.Intersection[] = [];

  /**
   * Shorten `desiredDistance` so the camera clears the world.
   * Returns the distance actually available.
   */
  probeDistance(
    target: THREE.Vector3,
    direction: THREE.Vector3,
    desiredDistance: number,
    world: CollisionWorld,
    nearRadius: number,
  ): number {
    if (!world.ready) return desiredDistance;

    this.dir.copy(direction).normalize();
    this.right.set(this.dir.z, 0, -this.dir.x);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
    this.up.crossVectors(this.right, this.dir).normalize();

    let closest = desiredDistance;
    for (const [ox, oy] of PROBE_OFFSETS) {
      this.origin
        .copy(target)
        .addScaledVector(this.right, ox * nearRadius)
        .addScaledVector(this.up, oy * nearRadius);
      const hit = world.raycast(this.origin, this.dir, desiredDistance + this.padding);
      if (hit) closest = Math.min(closest, hit.distance - this.padding);
    }
    return clamp(closest, 0.55, desiredDistance);
  }

  /**
   * Fade anything between the camera and the player.
   *
   * Only materials flagged `fadeable` at creation are touched, so a whole
   * house never vanishes — just the branch or trunk in the way.
   */
  updateOcclusionFade(
    cameraPos: THREE.Vector3,
    target: THREE.Vector3,
    scene: THREE.Object3D,
    dt: number,
  ): void {
    this.dir.copy(target).sub(cameraPos);
    const dist = this.dir.length();
    this.dir.multiplyScalar(1 / Math.max(dist, 1e-5));

    this.ray.set(cameraPos, this.dir);
    this.ray.near = 0;
    this.ray.far = Math.max(0, dist - 0.45);
    this.ray.firstHitOnly = false;

    this.hitList.length = 0;
    this.ray.intersectObject(scene, true, this.hitList);

    // Everything currently faded decays back to visible unless re-hit below.
    for (const mat of this.faded.keys()) this.faded.set(mat, 1);

    for (const hit of this.hitList) {
      const mesh = hit.object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) continue;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const tm = m as ToonMaterial;
        if (tm?.userData?.fade) this.faded.set(tm, 0.16);
      }
    }

    const k = damp(9, dt);
    for (const [mat, targetValue] of [...this.faded]) {
      const u = mat.userData.fade!;
      u.value += (targetValue - u.value) * k;
      if (targetValue === 1 && u.value > 0.995) {
        u.value = 1;
        this.faded.delete(mat);
      }
    }
  }

  /** Restore every faded material — used when the world is torn down. */
  clearFades(): void {
    for (const mat of this.faded.keys()) {
      const u = mat.userData.fade;
      if (u) u.value = 1;
    }
    this.faded.clear();
  }
}
