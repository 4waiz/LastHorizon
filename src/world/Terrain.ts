import * as THREE from 'three';
import { clamp, fbm2D, lerp, smoothstep, valueNoise2D } from '../utils/MathUtils';
import { makeToon } from '../graphics/ToonMaterial';
import {
  RoadNetwork,
  ROAD_BLEND,
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

  // boundary hills — a soft bowl so the map reads as enclosed, not cut off
  const r = Math.hypot(x * 0.92, (z + 10) * 0.86);
  h += smoothstep(112, 190, r) * 42;

  return h;
}

export interface TerrainSample {
  height: number;
  normal: THREE.Vector3;
}

export class Terrain {
  readonly size = WORLD_SIZE;
  readonly segments = TERRAIN_SEGMENTS;
  readonly cell = WORLD_SIZE / TERRAIN_SEGMENTS;

  /** (segments+1)^2 grid of final heights, shared by mesh and queries. */
  private heights: Float32Array;
  private colors: Float32Array;

  mesh!: THREE.Mesh;

  constructor(private readonly road: RoadNetwork) {
    const n = this.segments + 1;
    this.heights = new Float32Array(n * n);
    this.colors = new Float32Array(n * n * 3);
    this.computeGrid();
  }

  private computeGrid(): void {
    const n = this.segments + 1;
    const half = this.size / 2;

    const grass = new THREE.Color(0x93b87c);
    const grassDark = new THREE.Color(0x7ba367);
    const dry = new THREE.Color(0xc4be8a);
    const dirt = new THREE.Color(0xd2c296);
    const rock = new THREE.Color(0xa9a395);
    const tmp = new THREE.Color();

    for (let j = 0; j < n; j++) {
      const z = -half + j * this.cell;
      for (let i = 0; i < n; i++) {
        const x = -half + i * this.cell;
        const k = j * n + i;

        const nat = naturalHeight(x, z);
        const { dist, elevation } = this.road.sample(x, z);

        // Flat carriageway + shoulder, then a smooth ramp back to natural.
        const flatTo = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
        const w = smoothstep(flatTo, flatTo + ROAD_BLEND, dist);
        const h = lerp(elevation - 0.05, nat, w);
        this.heights[k] = h;

        // colour: dirt verge near the road, grass beyond, drier up high
        const verge = 1 - smoothstep(flatTo - 0.5, flatTo + 5.5, dist);
        const variation = valueNoise2D(x * 0.055 + 21, z * 0.055 - 9);
        const patch = smoothstep(0.62, 0.86, valueNoise2D(x * 0.021 - 4, z * 0.021 + 17));
        const altitude = smoothstep(16, 34, h);

        tmp.copy(grass).lerp(grassDark, variation * 0.75);
        tmp.lerp(dry, patch * 0.55 + altitude * 0.35);
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

    // PlaneGeometry rows run +X then -Z after the rotation; our grid runs
    // +X then +Z, so the row index has to be mirrored.
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const vi = j * n + i;
        const gi = (n - 1 - j) * n + i;
        pos.setY(vi, this.heights[gi]);
        colAttr.setXYZ(
          vi,
          this.colors[gi * 3],
          this.colors[gi * 3 + 1],
          this.colors[gi * 3 + 2],
        );
      }
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', colAttr);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const mat = makeToon(0xffffff);
    mat.vertexColors = true;
    mat.needsUpdate = true;

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
