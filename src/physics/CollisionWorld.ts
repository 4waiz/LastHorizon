import * as THREE from 'three';
import {
  MeshBVH,
  StaticGeometryGenerator,
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

// Accelerated raycasting for every geometry in the app.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/**
 * One merged, immovable BVH for the whole neighbourhood.
 *
 * Collision uses purpose-built *proxy* meshes (boxes for houses, hulls for
 * rocks, cylinders for trunks) rather than the render meshes. That keeps the
 * tree small, keeps the player out of window recesses and roof overhangs, and
 * means road markings and foliage can never produce a collision bump.
 */

const _tri = new THREE.Vector3();
const _cap = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export interface CapsuleResolveResult {
  /** How far the capsule had to move to leave the geometry. */
  displacement: THREE.Vector3;
  /** Best-guess upward-facing surface normal, if one was touched. */
  groundNormal: THREE.Vector3 | null;
}

export class CollisionWorld {
  collider: THREE.Mesh | null = null;
  private bvh: MeshBVH | null = null;
  private readonly box = new THREE.Box3();
  private readonly normal = new THREE.Vector3();

  /** Meshes the camera should treat as opaque blockers. */
  private cameraTargets: THREE.Object3D[] = [];

  get ready(): boolean {
    return this.bvh !== null;
  }

  /**
   * Merge proxy meshes into a single static geometry and build its BVH.
   * `meshes` must already have up-to-date world matrices.
   */
  build(meshes: THREE.Mesh[]): void {
    this.dispose();
    if (meshes.length === 0) return;

    for (const m of meshes) m.updateWorldMatrix(true, false);

    const generator = new StaticGeometryGenerator(meshes);
    generator.attributes = ['position'];
    generator.useGroups = false;
    const merged = generator.generate();

    // Construct the BVH directly rather than via the prototype helper: that
    // helper only exists on whichever copy of THREE.BufferGeometry got
    // patched, and a duplicated three install would silently break it.
    const bvh = new MeshBVH(merged, { maxLeafTris: 8 });
    merged.boundsTree = bvh;
    this.bvh = bvh;
    this.collider = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ visible: false }));
    this.collider.name = 'CollisionProxy';
    this.collider.matrixAutoUpdate = false;
    this.collider.updateMatrixWorld(true);
    this.cameraTargets = [this.collider];
  }

  get triangleCount(): number {
    const idx = this.collider?.geometry.getIndex();
    if (idx) return idx.count / 3;
    const pos = this.collider?.geometry.getAttribute('position');
    return pos ? pos.count / 3 : 0;
  }

  /**
   * Push a capsule out of the world.
   *
   * `segment` is the capsule's inner line (both endpoints inset by `radius`)
   * in world space and is modified in place. Returns how far it moved plus
   * the flattest surface normal encountered, which the motor uses for
   * grounding and slope limits.
   */
  resolveCapsule(
    segment: THREE.Line3,
    radius: number,
    out: CapsuleResolveResult,
  ): CapsuleResolveResult {
    out.displacement.set(0, 0, 0);
    out.groundNormal = null;
    if (!this.bvh) return out;

    const before = segment.start.clone();

    this.box.makeEmpty();
    this.box.expandByPoint(segment.start);
    this.box.expandByPoint(segment.end);
    this.box.min.addScalar(-radius);
    this.box.max.addScalar(radius);

    let bestUp = -1;
    const normal = this.normal;

    this.bvh.shapecast({
      intersectsBounds: (bounds) => bounds.intersectsBox(this.box),
      intersectsTriangle: (tri) => {
        const distance = tri.closestPointToSegment(segment, _tri, _cap);
        if (distance < radius) {
          const depth = radius - distance;
          _dir.copy(_cap).sub(_tri);
          if (_dir.lengthSq() < 1e-12) {
            tri.getNormal(_dir);
          } else {
            _dir.normalize();
          }
          segment.start.addScaledVector(_dir, depth);
          segment.end.addScaledVector(_dir, depth);

          tri.getNormal(normal);
          if (normal.y > bestUp) {
            bestUp = normal.y;
            out.groundNormal = (out.groundNormal ?? new THREE.Vector3()).copy(normal);
          }
        }
        return false;
      },
    });

    out.displacement.copy(segment.start).sub(before);
    return out;
  }

  /** First hit along a ray, or null. */
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, far: number): THREE.Intersection | null {
    if (!this.collider) return null;
    _ray.set(origin, direction);
    _ray.near = 0;
    _ray.far = far;
    _ray.firstHitOnly = true;
    const hits = _ray.intersectObject(this.collider, false);
    return hits.length ? hits[0] : null;
  }

  /** Downward probe used for ground snapping and object placement. */
  groundBelow(x: number, y: number, z: number, maxDrop = 12): number | null {
    const hit = this.raycast(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(0, -1, 0),
      maxDrop,
    );
    return hit ? hit.point.y : null;
  }

  get blockers(): THREE.Object3D[] {
    return this.cameraTargets;
  }

  dispose(): void {
    if (this.collider) {
      this.collider.geometry.disposeBoundsTree?.();
      this.collider.geometry.dispose();
      (this.collider.material as THREE.Material).dispose();
      this.collider = null;
    }
    this.bvh = null;
    this.cameraTargets = [];
  }
}
