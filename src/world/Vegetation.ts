import * as THREE from 'three';
import { Rng, smoothstep } from '../utils/MathUtils';
import { Terrain } from './Terrain';
import { RoadNetwork, ROAD_HALF_WIDTH, SHOULDER_WIDTH } from './RoadSystem';
import { makeToon, toonFromImported } from '../graphics/ToonMaterial';

/**
 * Instanced vegetation.
 *
 * Placement is composed, not sprinkled: a forest wall closes the horizon, a
 * handful of hand-placed anchors seed clusters along the road, and only the
 * filler is jittered. Scattering uniformly across the map is the fastest way
 * to make a world look procedurally generated.
 */

export interface Keepout {
  x: number;
  z: number;
  radius: number;
}

export interface PlacementContext {
  terrain: Terrain;
  road: RoadNetwork;
  keepouts: Keepout[];
}

/** Mirrors a prototype's meshes as InstancedMeshes sharing one transform list. */
export class InstancedSet {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private count = 0;

  constructor(prototype: THREE.Object3D, capacity: number, name: string) {
    this.group.name = `Inst_${name}`;
    prototype.updateWorldMatrix(true, true);
    const rootInverse = new THREE.Matrix4().copy(prototype.matrixWorld).invert();

    prototype.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone();
      // Bake the child's transform so every instance only needs a root matrix.
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld));

      const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const mat = toonFromImported(src, name);

      const inst = new THREE.InstancedMesh(geo, mat, capacity);
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      inst.count = 0;
      inst.frustumCulled = false;
      this.meshes.push(inst);
      this.group.add(inst);
    });
  }

  push(matrix: THREE.Matrix4): void {
    for (const m of this.meshes) {
      if (this.count < m.instanceMatrix.count) m.setMatrixAt(this.count, matrix);
    }
    this.count++;
  }

  finalise(): void {
    for (const m of this.meshes) {
      m.count = Math.min(this.count, m.instanceMatrix.count);
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  get instanceCount(): number {
    return this.count;
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.meshes = [];
  }
}

/** Anchors the composition hangs off. Hand-placed, not generated. */
interface Cluster {
  x: number;
  z: number;
  radius: number;
  big: number;
  med: number;
  small: number;
  bush: number;
  palm?: number;
}

const CLUSTERS: Cluster[] = [
  // near the start of the road, framing the first view down the hill
  { x: -26, z: 96, radius: 15, big: 2, med: 3, small: 3, bush: 6 },
  { x: 30, z: 84, radius: 17, big: 3, med: 2, small: 4, bush: 7, palm: 1 },
  // mid stretch, opposite the houses
  { x: -30, z: 42, radius: 16, big: 2, med: 3, small: 3, bush: 8 },
  { x: 34, z: 30, radius: 18, big: 3, med: 3, small: 2, bush: 6, palm: 1 },
  { x: -34, z: -6, radius: 17, big: 3, med: 2, small: 4, bush: 7 },
  // the rise toward the barrier
  { x: 32, z: -34, radius: 20, big: 4, med: 3, small: 3, bush: 8, palm: 1 },
  { x: -30, z: -48, radius: 18, big: 3, med: 4, small: 3, bush: 7 },
  { x: 26, z: -78, radius: 22, big: 4, med: 4, small: 4, bush: 6 },
  { x: -24, z: -88, radius: 20, big: 4, med: 3, small: 3, bush: 5 },
  // along the side road
  { x: 54, z: -6, radius: 16, big: 2, med: 3, small: 3, bush: 6, palm: 1 },
  { x: 80, z: -34, radius: 18, big: 3, med: 3, small: 2, bush: 5 },
];

export interface VegetationPrototypes {
  TreeBig: THREE.Object3D;
  TreeMed: THREE.Object3D;
  TreeSmall: THREE.Object3D;
  Palm: THREE.Object3D;
  DeadTree: THREE.Object3D;
  BushA: THREE.Object3D;
  BushB: THREE.Object3D;
  RockA: THREE.Object3D;
  RockB: THREE.Object3D;
  RockC: THREE.Object3D;
  GrassTuft: THREE.Object3D;
}

export class Vegetation {
  readonly group = new THREE.Group();
  private sets: InstancedSet[] = [];
  private grass: THREE.InstancedMesh | null = null;
  /** Cheap proxies (trunk cylinders, boulder boxes) for the collision BVH. */
  readonly propColliders: THREE.Mesh[] = [];
  private readonly invisible = new THREE.MeshBasicMaterial({ visible: false });
  private rockProxyGeo = new THREE.BoxGeometry(1, 1, 1);

  constructor(
    private readonly proto: VegetationPrototypes,
    private readonly ctx: PlacementContext,
    private readonly density: number,
    private readonly grassDensity: number,
  ) {
    this.group.name = 'Vegetation';
  }

  /** Reject roads, steep ground, buildings and anything off the map. */
  private valid(x: number, z: number, clearance: number, maxSlope = 0.42): boolean {
    const { terrain, road, keepouts } = this.ctx;
    if (!terrain.isInside(x, z, 8)) return false;
    if (road.sample(x, z).dist < ROAD_HALF_WIDTH + SHOULDER_WIDTH + clearance) return false;
    if (terrain.slopeAt(x, z) > maxSlope) return false;
    for (const k of keepouts) {
      const dx = x - k.x;
      const dz = z - k.z;
      if (dx * dx + dz * dz < (k.radius + clearance) * (k.radius + clearance)) return false;
    }
    return true;
  }

  private place(
    set: InstancedSet,
    rng: Rng,
    x: number,
    z: number,
    scaleMin: number,
    scaleMax: number,
    tiltAmount = 0.05,
  ): boolean {
    const y = this.ctx.terrain.heightAt(x, z);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(
      rng.jitter(tiltAmount),
      rng.range(0, Math.PI * 2),
      rng.jitter(tiltAmount),
    );
    q.setFromEuler(e);
    const s = rng.range(scaleMin, scaleMax);
    m.compose(new THREE.Vector3(x, y - 0.08, z), q, new THREE.Vector3(s, s, s));
    set.push(m);
    return true;
  }

  build(): void {
    const rng = new Rng(778899);
    const d = this.density;

    const big = new InstancedSet(this.proto.TreeBig, Math.ceil(360 * d) + 40, 'TreeBig');
    const med = new InstancedSet(this.proto.TreeMed, Math.ceil(260 * d) + 30, 'TreeMed');
    const small = new InstancedSet(this.proto.TreeSmall, Math.ceil(240 * d) + 30, 'TreeSmall');
    const palm = new InstancedSet(this.proto.Palm, 30, 'Palm');
    const dead = new InstancedSet(this.proto.DeadTree, 24, 'DeadTree');
    const bushA = new InstancedSet(this.proto.BushA, Math.ceil(300 * d) + 40, 'BushA');
    const bushB = new InstancedSet(this.proto.BushB, Math.ceil(300 * d) + 40, 'BushB');
    const rockA = new InstancedSet(this.proto.RockA, 46, 'RockA');
    const rockB = new InstancedSet(this.proto.RockB, 70, 'RockB');
    const rockC = new InstancedSet(this.proto.RockC, 120, 'RockC');
    this.sets = [big, med, small, palm, dead, bushA, bushB, rockA, rockB, rockC];

    // 1. Forest wall — dense ring on the boundary hills, closing the bowl.
    const ringCount = Math.round(430 * Math.max(0.5, d));
    for (let i = 0; i < ringCount; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(104, 168);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 8;
      if (!this.ctx.terrain.isInside(x, z, 4)) continue;
      if (this.ctx.road.sample(x, z).dist < 16) continue;
      if (this.ctx.terrain.slopeAt(x, z) > 0.72) continue;
      const pick = rng.next();
      const set = pick < 0.46 ? big : pick < 0.78 ? med : small;
      this.place(set, rng, x, z, 0.85, 1.5, 0.03);
    }

    // 2. Hand-placed clusters along the road.
    for (const c of CLUSTERS) {
      const scale = Math.max(0.4, d);
      const spawn = (set: InstancedSet, n: number, clearance: number, lo: number, hi: number) => {
        const target = Math.round(n * scale);
        for (let i = 0, guard = 0; i < target && guard < target * 14; guard++) {
          const a = rng.range(0, Math.PI * 2);
          // bias toward the cluster centre so the shape reads as a copse
          const r = c.radius * Math.sqrt(rng.next()) * 0.95;
          const x = c.x + Math.cos(a) * r;
          const z = c.z + Math.sin(a) * r;
          if (!this.valid(x, z, clearance, 0.5)) continue;
          this.place(set, rng, x, z, lo, hi);
          i++;
        }
      };
      spawn(big, c.big, 3.2, 0.9, 1.35);
      spawn(med, c.med, 2.4, 0.85, 1.25);
      spawn(small, c.small, 1.8, 0.85, 1.3);
      spawn(bushA, c.bush, 1.0, 0.8, 1.4);
      spawn(bushB, Math.round(c.bush * 0.8), 0.8, 0.85, 1.45);
      if (c.palm) spawn(palm, c.palm, 3.0, 0.9, 1.2);
    }

    // 3. Verge bushes hugging the shoulder, breaking the road edge.
    const vergeCount = Math.round(150 * Math.max(0.5, d));
    for (let i = 0, guard = 0; i < vergeCount && guard < vergeCount * 12; guard++) {
      const t = rng.next();
      const line = rng.next() < 0.75 ? this.ctx.road.main : this.ctx.road.side;
      const idx = Math.floor(t * (line.pts.length - 1));
      const p = line.pts[idx];
      const tan = line.tangents[idx];
      const side = rng.next() < 0.5 ? -1 : 1;
      const off = side * rng.range(ROAD_HALF_WIDTH + SHOULDER_WIDTH + 0.8, ROAD_HALF_WIDTH + 11);
      const x = p.x + -tan.y * off;
      const z = p.z + tan.x * off;
      if (!this.valid(x, z, 0.4, 0.55)) continue;
      this.place(rng.next() < 0.5 ? bushA : bushB, rng, x, z, 0.7, 1.3);
      i++;
    }

    // 4. Rocks — larger ones on slopes, pebbles anywhere.
    const rockCount = Math.round(150 * Math.max(0.5, d));
    for (let i = 0, guard = 0; i < rockCount && guard < rockCount * 10; guard++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(14, 120);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 6;
      if (!this.valid(x, z, 0.6, 0.85)) continue;
      const slope = this.ctx.terrain.slopeAt(x, z);
      const pick = rng.next();
      if (pick < 0.14 && slope > 0.12) {
        this.place(rockA, rng, x, z, 0.7, 1.35, 0.13);
        this.addRockCollider(x, z, 2.6, 1.5);
      } else if (pick < 0.44) {
        this.place(rockB, rng, x, z, 0.7, 1.4, 0.16);
        this.addRockCollider(x, z, 1.7, 1.0);
      } else {
        this.place(rockC, rng, x, z, 0.6, 1.5, 0.22);
      }
      i++;
    }

    // 5. A few bare trees for silhouette variety.
    for (let i = 0, guard = 0; i < 14 && guard < 200; guard++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(30, 110);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 6;
      if (!this.valid(x, z, 2.5, 0.5)) continue;
      this.place(dead, rng, x, z, 0.85, 1.3);
      i++;
    }

    for (const s of this.sets) {
      s.finalise();
      this.group.add(s.group);
    }

    this.buildTrunkColliders(rng);
    if (this.grassDensity > 0) this.buildGrass();
  }

  /** Boulders get a squat box proxy so the player can't walk through them. */
  private addRockCollider(x: number, z: number, width: number, height: number): void {
    const m = new THREE.Mesh(this.rockProxyGeo, this.invisible);
    m.position.set(x, this.ctx.terrain.heightAt(x, z) + height * 0.42, z);
    m.scale.set(width, height, width * 0.92);
    m.updateMatrixWorld(true);
    this.propColliders.push(m);
  }

  /**
   * Cheap cylinder proxies so the player bumps into trunks. Only trees near
   * the walkable corridor get one — the boundary forest is unreachable.
   */
  private buildTrunkColliders(rng: Rng): void {
    const geo = new THREE.CylinderGeometry(0.36, 0.42, 3.4, 6, 1, true);
    const mat = this.invisible;
    for (const c of CLUSTERS) {
      const n = Math.round((c.big + c.med) * Math.max(0.4, this.density));
      for (let i = 0, guard = 0; i < n && guard < n * 12; guard++) {
        const a = rng.range(0, Math.PI * 2);
        const r = c.radius * Math.sqrt(rng.next()) * 0.9;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (!this.valid(x, z, 3.0, 0.5)) continue;
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, this.ctx.terrain.heightAt(x, z) + 1.7, z);
        m.updateMatrixWorld(true);
        this.propColliders.push(m);
        i++;
      }
    }
  }

  /** Grass only inside the walkable corridor, where the player can see it. */
  private buildGrass(): void {
    const src = this.proto.GrassTuft;
    let geo: THREE.BufferGeometry | null = null;
    src.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && !geo) geo = m.geometry.clone();
    });
    if (!geo) return;

    const rng = new Rng(31337);
    const target = Math.round(13000 * this.grassDensity);
    const mat = makeToon(0x74975c, { kind: 'grass', side: THREE.DoubleSide });

    const inst = new THREE.InstancedMesh(geo, mat, target);
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    inst.name = 'Grass';

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();

    let n = 0;
    for (let guard = 0; n < target && guard < target * 8; guard++) {
      // Concentrated along the road corridor rather than the whole map.
      const line = rng.next() < 0.78 ? this.ctx.road.main : this.ctx.road.side;
      const idx = Math.floor(rng.next() * (line.pts.length - 1));
      const p = line.pts[idx];
      const tan = line.tangents[idx];
      const side = rng.next() < 0.5 ? -1 : 1;
      const edge = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
      const off = side * (edge + Math.pow(rng.next(), 0.7) * 26);
      const x = p.x + -tan.y * off + rng.jitter(2.2);
      const z = p.z + tan.x * off + rng.jitter(2.2);
      if (!this.ctx.terrain.isInside(x, z, 8)) continue;
      if (this.ctx.road.sample(x, z).dist < edge + 0.35) continue;
      if (this.ctx.terrain.slopeAt(x, z) > 0.5) continue;

      // thin out with distance from the verge so it fades rather than stops
      if (rng.next() > 1 - smoothstep(edge + 26, edge + 2, Math.abs(off))) continue;

      pos.set(x, this.ctx.terrain.heightAt(x, z) - 0.04, z);
      e.set(0, rng.range(0, Math.PI * 2), 0);
      q.setFromEuler(e);
      const s = rng.range(0.62, 1.12);
      scl.set(s, rng.range(0.62, 1.08), s);
      m.compose(pos, q, scl);
      inst.setMatrixAt(n, m);
      n++;
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    this.grass = inst;
    this.group.add(inst);
  }

  get stats(): { instances: number; grass: number } {
    return {
      instances: this.sets.reduce((a, s) => a + s.instanceCount, 0),
      grass: this.grass?.count ?? 0,
    };
  }

  dispose(): void {
    for (const s of this.sets) s.dispose();
    this.sets = [];
    if (this.grass) {
      this.grass.geometry.dispose();
      this.grass.dispose();
      this.grass = null;
    }
    this.rockProxyGeo.dispose();
    this.invisible.dispose();
    this.propColliders.length = 0;
  }
}
