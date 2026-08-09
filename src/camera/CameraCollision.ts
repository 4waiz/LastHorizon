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
   * The only meshes worth raycasting: those whose material can actually fade.
   *
   * The first version raycast the entire scene with `firstHitOnly = false`,
   * then threw away every hit whose material was not `fadeable`. That is a
   * full all-hits traversal of the terrain's BVH, plus CPU-skinning of every
   * skinned mesh in shot, to find at most a couple of tree trunks — measured
   * at 10.6 ms a frame in a dev build, the single largest item in the frame,
   * and it made the population's browser tests time out before it made
   * anything else fail.
   *
   * Rebuilt periodically rather than per frame: the fadeable set is
   * vegetation, which is built when a zone loads and does not change between
   * one frame and the next.
   */
  private candidates: THREE.Object3D[] = [];
  private sinceRefresh = Number.POSITIVE_INFINITY;

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

    this.refreshCandidates(scene, dt);
    this.pruneDetached();
    this.hitList.length = 0;
    // `false`: the candidate list is already flat, so recursing would walk
    // each mesh's (empty) children for nothing.
    if (this.candidates.length > 0) {
      this.ray.intersectObjects(this.candidates, false, this.hitList);
    }

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

  /** Seconds between rebuilds of the fadeable-mesh list. */
  private static readonly REFRESH_SECONDS = 0.5;

  /**
   * Collect the meshes whose material can fade.
   *
   * Half a second of staleness costs nothing: the fadeable set is vegetation,
   * placed when a zone builds. A tree that appears mid-second stays solid for
   * up to thirty frames and then behaves, which nobody can see; the
   * alternative is paying for a full-scene raycast sixty times a second to
   * discover the same list.
   */
  private refreshCandidates(scene: THREE.Object3D, dt: number): void {
    this.sinceRefresh += dt;
    if (this.sinceRefresh < CameraCollision.REFRESH_SECONDS) return;
    this.sinceRefresh = 0;

    this.candidates.length = 0;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ((m as ToonMaterial)?.userData?.fade) {
          this.candidates.push(mesh);
          return;
        }
      }
    });
  }

  /**
   * Drop anything detached from the scene since the last rebuild.
   *
   * A zone teardown removes and disposes its meshes; raycasting one held in a
   * list up to half a second stale would be reading freed geometry. The list
   * is short — vegetation is instanced — so checking it every frame is
   * cheaper than the bug.
   */
  private pruneDetached(): void {
    for (let i = this.candidates.length - 1; i >= 0; i--) {
      if (!this.candidates[i].parent) this.candidates.splice(i, 1);
    }
  }

  /** Force the next frame to rebuild the list. Used on zone change. */
  invalidateCandidates(): void {
    this.sinceRefresh = Number.POSITIVE_INFINITY;
  }

  /** How many meshes the fade pass actually tests. For the debug overlay. */
  get fadeCandidateCount(): number {
    return this.candidates.length;
  }

  /** Restore every faded material — used when the world is torn down. */
  clearFades(): void {
    for (const mat of this.faded.keys()) {
      const u = mat.userData.fade;
      if (u) u.value = 1;
    }
    this.faded.clear();
    // The meshes those materials belonged to are about to be disposed.
    this.candidates.length = 0;
    this.invalidateCandidates();
  }
}
