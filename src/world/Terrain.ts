import * as THREE from 'three';
import { clamp, fbm2D, lerp, smoothstep, valueNoise2D } from '../utils/MathUtils';
import { makeToon } from '../graphics/ToonMaterial';
import {
  RoadNetwork,
  ROAD_BLEND,
  ROAD_CUT,
  ROAD_HALF_WIDTH,
  SHOULDER_WIDTH,
} from './RoadSystem';

/**
 * Heightfield terrain.
 *
 * Resolution is fixed rather than driven by the quality preset: the same
 * grid feeds both the visible mesh and the collision BVH, so changing it at
 * runtime would make the player sink or float. Quality scales vegetation,
 * shadows and effects instead.
 */

export const WORLD_SIZE = 360;
export const TERRAIN_SEGMENTS = 176;

/**
 * Ground height ignoring roads: a long climb toward -Z, rolling noise, and a
 * ring of hills that closes the playable bowl.
 */
export function naturalHeight(x: number, z: number): number {
  // main slope up toward the hill at -Z
  const t = clamp((150 - z) / 300, 0, 1);
  let h = smoothstep(0, 1, t) * 17.5;

  // rolling ground
  h += (fbm2D(x * 0.0085 + 11.3, z * 0.0085 - 4.7, 3) - 0.5) * 9.0;
  h += (valueNoise2D(x * 0.032 + 3.1, z * 0.032 + 8.4) - 0.5) * 1.9;
  h += (valueNoise2D(x * 0.085 - 5.5, z * 0.085 + 1.2) - 0.5) * 0.55;

  // raised banks either side of the valley the road runs through
  const bank = smoothstep(10, 46, Math.abs(x - z * 0.06));
  h += bank * 4.2;

  // Boundary hills — a soft bowl so the map reads as enclosed rather than
  // cut off. Kept low and pushed well out: raise them and they eat the sky,
  // which is half of what makes the reference frames feel open.
  const r = Math.hypot(x * 0.92, (z + 10) * 0.86);
  h += smoothstep(132, 218, r) * 30;

  return h;
}

/**
 * A flattened building platform.
 *
 * Seating a building at the terrain height of its centre leaves the downhill
 * corners hanging in mid-air on any slope. Levelling a pad under the
 * footprint — and ramping back to natural ground around it — is how real
 * level geometry handles it, and it also gives interiors a flat floor.
 */
export interface BuildingPad {
  x: number;
  z: number;
  /** Radians about +Y, matching the building's yaw. */
  yaw: number;
  halfX: number;
  halfZ: number;
  /** Metres over which the ground ramps back to natural. */
  blend: number;
}

export class Terrain {
  readonly size = WORLD_SIZE;
  readonly segments = TERRAIN_SEGMENTS;
  readonly cell = WORLD_SIZE / TERRAIN_SEGMENTS;

  /** (segments+1)^2 grid of final heights, shared by mesh and queries. */
  private heights: Float32Array;
  private colors: Float32Array;

  mesh!: THREE.Mesh;

  private padLevels: number[] = [];

  constructor(
    private readonly road: RoadNetwork,
    private readonly pads: BuildingPad[] = [],
  ) {
    const n = this.segments + 1;
    this.heights = new Float32Array(n * n);
    this.colors = new Float32Array(n * n * 3);
    this.padLevels = pads.map((p) => this.roadBlended(p.x, p.z));
    this.computeGrid();
  }

  /** Ground height accounting for the road corridor but not building pads. */
  private roadBlended(x: number, z: number): number {
    const nat = naturalHeight(x, z);
    const { dist, elevation } = this.road.sample(x, z);
    const flatTo = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
    const w = smoothstep(flatTo, flatTo + ROAD_BLEND, dist);
    return lerp(elevation - ROAD_CUT, nat, w);
  }

  /** Level of the pad a building sits on, in world units. */
  padLevel(index: number): number {
    return this.padLevels[index] ?? 0;
  }

  /** Flatten toward any pad this point falls inside or near. */
  private applyPads(x: number, z: number, h: number): number {
    let out = h;
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i];
      const dx = x - p.x;
      const dz = z - p.z;
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      // rotate the world offset into the pad's local frame
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const ox = Math.max(0, Math.abs(lx) - p.halfX);
      const oz = Math.max(0, Math.abs(lz) - p.halfZ);
      const d = Math.hypot(ox, oz);
      if (d >= p.blend) continue;
      out = lerp(this.padLevels[i], out, smoothstep(0, p.blend, d));
    }
    return out;
  }

  private computeGrid(): void {
    const n = this.segments + 1;
    const half = this.size / 2;

    const grass = new THREE.Color(0xa2c785);
    const grassDark = new THREE.Color(0x89b06e);
    const dry = new THREE.Color(0xcbc796);
    const dirt = new THREE.Color(0xd2c296);
    const rock = new THREE.Color(0xa9a395);
    const tmp = new THREE.Color();

    for (let j = 0; j < n; j++) {
      const z = -half + j * this.cell;
      for (let i = 0; i < n; i++) {
        const x = -half + i * this.cell;
        const k = j * n + i;

        const { dist } = this.road.sample(x, z);
        const flatTo = ROAD_HALF_WIDTH + SHOULDER_WIDTH;

        // Flat carriageway + shoulder, then a ramp back to natural ground,
        // then any building pads levelled on top of that.
        const h = this.applyPads(x, z, this.roadBlended(x, z));
        this.heights[k] = h;

        // colour: dirt verge near the road, grass beyond, drier up high
        const verge = 1 - smoothstep(flatTo - 0.5, flatTo + 5.5, dist);
        const variation = valueNoise2D(x * 0.055 + 21, z * 0.055 - 9);
        const patch = smoothstep(0.62, 0.86, valueNoise2D(x * 0.021 - 4, z * 0.021 + 17));
        const altitude = smoothstep(16, 34, h);

        tmp.copy(grass).lerp(grassDark, variation * 0.75);
        tmp.lerp(dry, patch * 0.34 + altitude * 0.26);
        tmp.lerp(dirt, verge);
        tmp.lerp(rock, smoothstep(30, 48, h) * 0.35);

        this.colors[k * 3] = tmp.r;
        this.colors[k * 3 + 1] = tmp.g;
        this.colors[k * 3 + 2] = tmp.b;
      }
    }
  }

  build(): THREE.Mesh {
    const n = this.segments + 1;
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colAttr = new THREE.Float32BufferAttribute(n * n * 3, 3);

    // After rotateX(-PI/2) a PlaneGeometry's row index runs along +Z, matching
    // our grid's j exactly — so vertex order and grid order line up 1:1.
    // (Getting this backwards mirrors the terrain against the road and buries
    // the carriageway under the hillside.)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        pos.setY(k, this.heights[k]);
        colAttr.setXYZ(k, this.colors[k * 3], this.colors[k * 3 + 1], this.colors[k * 3 + 2]);
      }
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', colAttr);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const mat = makeToon(0xffffff, { id: 'terrain', vertexColors: true });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'Terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    return this.mesh;
  }

  private gridIndex(i: number, j: number): number {
    const n = this.segments + 1;
    return clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1);
  }

  /** Bilinear height lookup against the exact grid the collider uses. */
  heightAt(x: number, z: number): number {
    const half = this.size / 2;
    const fx = clamp((x + half) / this.cell, 0, this.segments - 1e-4);
    const fz = clamp((z + half) / this.cell, 0, this.segments - 1e-4);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h00 = this.heights[this.gridIndex(i, j)];
    const h10 = this.heights[this.gridIndex(i + 1, j)];
    const h01 = this.heights[this.gridIndex(i, j + 1)];
    const h11 = this.heights[this.gridIndex(i + 1, j + 1)];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  /** Central-difference surface normal; used to reject steep prop placement. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.cell;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x: number, z: number): number {
    return 1 - this.normalAt(x, z).y;
  }

  isInside(x: number, z: number, margin = 6): boolean {
    const h = this.size / 2 - margin;
    return x > -h && x < h && z > -h && z < h;
  }
}
