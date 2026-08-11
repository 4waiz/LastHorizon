import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeToon } from '../../graphics/ToonMaterial';
import type { DisposalRegistry } from '../../core/DisposalRegistry';

/**
 * The primitives every procedural zone builder needs.
 *
 * Lifted out of `CityBuilder` when the airstrip arrived and needed the same
 * four helpers. The alternative was for `AirstripBuilder` to import
 * `CityBuilder`, which would have pulled the whole district generator into the
 * chunk a player downloads by walking to a runway — 6 kB of shells, parking
 * bays and waterfront they will never see from there.
 *
 * Nothing here knows what a road or a runway is. That belongs to the builders.
 */

/**
 * Deterministic RNG. Local by construction, so a chunk's contents never depend
 * on global state or on the order chunks happen to stream in.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A box, positioned by its centre, ready to merge. */
export function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** A cylinder standing on Y, positioned by its centre. */
export function cylinder(
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  segments = 8,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, height, segments);
  g.translate(x, y, z);
  return g;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface AABB {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Clip a world-space rect to a bounding box.
 *
 * Roads and runways are authored as continuous world-space strips, and each
 * chunk emits only the part that falls inside it. That is what keeps a
 * carriageway seamless across a chunk seam: neighbouring chunks contribute
 * abutting pieces of one strip rather than each guessing where it should be.
 */
export function clip(b: AABB, r: Rect): Rect | null {
  const x0 = Math.max(b.minX, r.x0);
  const x1 = Math.min(b.maxX, r.x1);
  const z0 = Math.max(b.minZ, r.z0);
  const z1 = Math.min(b.maxZ, r.z1);
  if (x1 - x0 <= 1e-4 || z1 - z0 <= 1e-4) return null;
  return { x0, z0, x1, z1 };
}

/** True if the point lies inside the rect, edges included. */
export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** Accumulates geometry per palette colour so each colour becomes one mesh. */
export class Batch {
  private readonly byColor = new Map<number, THREE.BufferGeometry[]>();

  add(color: number, geo: THREE.BufferGeometry): void {
    const list = this.byColor.get(color);
    if (list) list.push(geo);
    else this.byColor.set(color, [geo]);
  }

  /** A flat slab covering `r`, `thickness` tall, sitting with its top at `y`. */
  slab(color: number, r: Rect, y: number, thickness: number): void {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    this.add(color, box(w, thickness, d, (r.x0 + r.x1) / 2, y - thickness / 2, (r.z0 + r.z1) / 2));
  }

  /**
   * Merge each colour group into a single mesh, register both geometry and
   * the parent link for disposal, and attach to `parent`.
   *
   * Materials come from `makeToon`, which caches by value — so a new zone
   * reuses the village's programs rather than compiling its own.
   */
  flush(parent: THREE.Object3D, scope: DisposalRegistry, label: string): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [color, parts] of this.byColor) {
      const merged = mergeGeometries(parts, false);
      // mergeGeometries clones; the sources are now dead weight.
      parts.forEach((p) => p.dispose());
      if (!merged) continue;

      const mesh = new THREE.Mesh(merged, makeToon(color));
      mesh.name = `${label}_${color.toString(16)}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);

      scope.addTeardown(
        () => {
          mesh.removeFromParent();
          merged.dispose();
          // The material is shared and cached by ToonMaterial; disposing it
          // here would pull it out from under every other user of that colour.
        },
        'geometry',
        `${label}:${color.toString(16)}`,
      );
    }
    this.byColor.clear();
    return meshes;
  }
}

/**
 * Colours shared across procedural zones.
 *
 * Deliberately one table rather than one per builder: `makeToon` caches by
 * colour, so two builders naming the same grey with different literals would
 * compile two programs for one visual result. `customProgramCacheKey` keeps
 * ~99 imported materials on 23 programs and this is the same economy.
 */
export const ZONE_PALETTE = {
  road: 0x55565a,
  sidewalk: 0xb9b3a4,
  marking: 0xe8e3d2,
  wallWarm: 0xd8c3a5,
  wallPink: 0xd9b9b0,
  wallCool: 0xb8bcc0,
  roofRed: 0xc4633f,
  roofDark: 0x6b5b52,
  glass: 0x8fb3bf,
  metal: 0x7d8288,
  water: 0x5b8fa8,
  skyline: 0xa9b4bd,
  grassDry: 0x9aa66a,
} as const;
