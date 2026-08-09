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
  /**
   * A second, small tree for whichever interior is currently open.
   *
   * The world's BVH is the whole neighbourhood and takes a few hundred
   * milliseconds to build; a room is about forty boxes. Rebuilding the world
   * every time somebody opens a door would be absurd, and building all nine
   * interiors up front would keep nine rooms resident for the eight you are
   * not in. So the active room gets its own tree, swapped on entry and
   * dropped on exit.
   *
   * Both trees are consulted on every query. That is close to free outdoors:
   * the interior cell sits hundreds of metres away, so the root bounds test
   * rejects it immediately.
   */
  private overlay: MeshBVH | null = null;
  private overlayMesh: THREE.Mesh | null = null;
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

    const built = this.mergeAndBuild(meshes, 'CollisionProxy');
    if (!built) return;
    this.bvh = built.bvh;
    this.collider = built.mesh;
    this.refreshCameraTargets();
  }

  /**
   * Hand over the active interior's collision, or `null` to drop it.
   *
   * Idempotent: passing new meshes disposes whatever was there first, so a
   * player who walks in and out of nine buildings leaves one tree behind, not
   * nine.
   */
  setOverlay(meshes: THREE.Mesh[] | null): void {
    if (this.overlayMesh) {
      this.overlayMesh.geometry.disposeBoundsTree?.();
      this.overlayMesh.geometry.dispose();
      (this.overlayMesh.material as THREE.Material).dispose();
      this.overlayMesh = null;
    }
    this.overlay = null;

    if (meshes && meshes.length > 0) {
      const built = this.mergeAndBuild(meshes, 'InteriorCollisionProxy');
      if (built) {
        this.overlay = built.bvh;
        this.overlayMesh = built.mesh;
      }
    }
    this.refreshCameraTargets();
  }

  get overlayTriangleCount(): number {
    const idx = this.overlayMesh?.geometry.getIndex();
    if (idx) return idx.count / 3;
    const pos = this.overlayMesh?.geometry.getAttribute('position');
    return pos ? pos.count / 3 : 0;
  }

  private mergeAndBuild(
    meshes: THREE.Mesh[],
    name: string,
  ): { bvh: MeshBVH; mesh: THREE.Mesh } | null {
    for (const m of meshes) m.updateWorldMatrix(true, false);

    const generator = new StaticGeometryGenerator(meshes);
    generator.attributes = ['position'];
    generator.useGroups = false;
    const merged = generator.generate();

    // Construct the BVH directly rather than via the prototype helper: that
    // helper only exists on whichever copy of THREE.BufferGeometry got
    // patched, and a duplicated three install would silently break it.
    // `targetLeafSize` is three-mesh-bvh 0.9's name for what was `maxLeafTris`
    // — a straight rename, same leaf-capacity threshold in buildTree.
    const bvh = new MeshBVH(merged, { targetLeafSize: 8 });
    merged.boundsTree = bvh;
    const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ visible: false }));
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrixWorld(true);
    return { bvh, mesh };
  }

  private refreshCameraTargets(): void {
    this.cameraTargets = [this.collider, this.overlayMesh].filter(
      (m): m is THREE.Mesh => m !== null,
    );
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
    if (!this.bvh && !this.overlay) return out;

    const before = segment.start.clone();

    let bestUp = -1;
    const normal = this.normal;

    // The box has to be recomputed per tree: the first pass moves the segment,
    // and the second must test against where it ended up, not where it began.
    const castAgainst = (bvh: MeshBVH): void => {
      this.box.makeEmpty();
      this.box.expandByPoint(segment.start);
      this.box.expandByPoint(segment.end);
      this.box.min.addScalar(-radius);
      this.box.max.addScalar(radius);

      bvh.shapecast({
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
    };

    if (this.bvh) castAgainst(this.bvh);
    if (this.overlay) castAgainst(this.overlay);

    out.displacement.copy(segment.start).sub(before);
    return out;
  }

  /** First hit along a ray across both trees, or null. */
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, far: number): THREE.Intersection | null {
    if (this.cameraTargets.length === 0) return null;
    _ray.set(origin, direction);
    _ray.near = 0;
    _ray.far = far;
    _ray.firstHitOnly = true;
    // `intersectObjects` sorts by distance, so the nearest hit across the
    // world and the open room comes out first without a manual compare.
    const hits = _ray.intersectObjects(this.cameraTargets, false);
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
    this.setOverlay(null);
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
