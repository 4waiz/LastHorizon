import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain, WORLD_SIZE } from './Terrain';
import { RoadNetwork, buildRoadMeshes, ROAD_HALF_WIDTH, SHOULDER_WIDTH } from './RoadSystem';
import { naturalHeight } from './Terrain';
import { Vegetation, VegetationPrototypes, Keepout } from './Vegetation';
import { Birds } from './Birds';
import { Collectibles, CollectibleDef } from './Collectibles';
import { Interiors } from './Interiors';
import { CollisionWorld } from '../physics/CollisionWorld';
import { makeToon, toonFromImported } from '../graphics/ToonMaterial';
import { QualityPreset } from '../core/Settings';
import { Rng } from '../utils/MathUtils';
import { AssetBundle } from '../core/AssetManager';

/**
 * Assembles the neighbourhood.
 *
 * Layout is authored by hand (see PLACEMENTS) rather than generated, because
 * composition is the whole point: the road has to read as a place someone
 * lives, with sightlines that work from every angle a third-person camera
 * can find.
 */

interface Placement {
  model: string;
  x: number;
  z: number;
  /** Radians about +Y. Models face +Z at 0. */
  yaw: number;
  /** Simple one-box collider: half-extents plus a local centre offset. */
  collider?: { hx: number; hy: number; hz: number; oy?: number; oz?: number };
  /** Radius vegetation must stay out of. */
  keepout?: number;
  /** Footprint levelled flat under the building, half-extents in local space. */
  pad?: { hx: number; hz: number; blend?: number };
  /** Raised above the levelled pad by this much. */
  lift?: number;
  /** Front door position in local space; adds an "enter" prompt. */
  door?: { x: number; z: number };
  /** Depth of the foundation skirt that hides any gap on a slope. */
  skirt?: number;
}

const HALF_PI = Math.PI / 2;

export const PLACEMENTS: Placement[] = [
  // ---- west side of the main road, the hero row ------------------------
  { model: 'HouseLarge', x: -15.8, z: 62, yaw: HALF_PI,
    door: { x: 1.35, z: 4.0 }, skirt: 2.5,
    collider: { hx: 3.4, hy: 5.6, hz: 4.2, oy: 3.0 }, keepout: 9.5,
    pad: { hx: 3.9, hz: 4.7, blend: 2.8 } },
  { model: 'HouseSolar', x: -16.6, z: 43, yaw: HALF_PI + 0.06,
    door: { x: 0.15, z: 3.7 }, skirt: 2.5,
    collider: { hx: 3.1, hy: 2.4, hz: 3.7, oy: 1.6 }, keepout: 8.5,
    pad: { hx: 3.6, hz: 4.2, blend: 2.8 } },
  { model: 'Shed', x: -15.2, z: 31.5, yaw: HALF_PI - 0.22,
    door: { x: 0, z: 2.5 }, skirt: 2.0,
    collider: { hx: 1.7, hy: 1.5, hz: 2.4, oy: 1.2 }, keepout: 4.5,
    pad: { hx: 2.3, hz: 3.0, blend: 2.2 } },

  // ---- east side ---------------------------------------------------------
  // The one you can walk into.
  { model: 'HouseSmall', x: 15.6, z: 33, yaw: -HALF_PI,
    door: { x: -0.55, z: 3.4 }, skirt: 2.5,
    collider: { hx: 2.7, hy: 2.6, hz: 3.4, oy: 1.7 }, keepout: 8.5,
    pad: { hx: 3.2, hz: 3.9, blend: 2.6 } },
  // Was at z=6, which put it 5.4 m from the side road's centreline — its pad
  // cut into the carriageway. Moved south, clear of the junction.
  { model: 'PorchHouse', x: 17.6, z: -2, yaw: -HALF_PI - 0.05,
    door: { x: 0.55, z: 1.9 }, skirt: 2.5,
    collider: { hx: 2.4, hy: 2.0, hz: 3.9, oy: 1.6, oz: 0.9 }, keepout: 8.5,
    pad: { hx: 3.0, hz: 4.4, blend: 2.6 } },
  { model: 'HouseSmall', x: 18.6, z: -24, yaw: -HALF_PI + 0.14,
    door: { x: -0.55, z: 3.4 }, skirt: 2.5,
    collider: { hx: 2.7, hy: 2.6, hz: 3.4, oy: 1.7 }, keepout: 8.0,
    pad: { hx: 3.2, hz: 3.9, blend: 2.6 } },

  // ---- along the side road ----------------------------------------------
  // Both of these had their backs to the side road. Models face +Z, so the
  // yaw has to point local +Z at the carriageway, not away from it.
  { model: 'HouseLarge', x: 52, z: -22, yaw: 0.62,
    door: { x: 1.35, z: 4.0 }, skirt: 2.5,
    collider: { hx: 3.4, hy: 5.6, hz: 4.2, oy: 3.0 }, keepout: 9.5,
    pad: { hx: 3.9, hz: 4.7, blend: 2.8 } },
  { model: 'Shed', x: 66, z: -40, yaw: 0.60,
    door: { x: 0, z: 2.5 }, skirt: 2.0,
    collider: { hx: 1.7, hy: 1.5, hz: 2.4, oy: 1.2 }, keepout: 4.5,
    pad: { hx: 2.3, hz: 3.0, blend: 3.0 } },
];

/** Something the player can walk up to and press interact on. */
export interface Interactable {
  position: THREE.Vector3;
  radius: number;
  kind: 'sleep' | 'enter' | 'exit' | 'sit' | 'wardrobe';
  prompt: string;
}

/** Retaining walls cut into the embankment, as in the reference frames. */
const WALLS: Array<{ x: number; z: number; yaw: number }> = [
  { x: -13.6, z: 22, yaw: 0 },
  { x: -13.9, z: 16, yaw: 0.02 },
  { x: -14.2, z: 10, yaw: 0.04 },
  { x: 15.6, z: -44, yaw: Math.PI },
  { x: 15.9, z: -50, yaw: Math.PI - 0.03 },
];

const FENCES: Array<{ x: number; z: number; yaw: number }> = [
  { x: 27.5, z: 12, yaw: 0 },
  { x: 27.6, z: 8, yaw: 0 },
  { x: 27.7, z: 4, yaw: 0 },
];

export interface WorldStats {
  vegetation: number;
  grass: number;
  colliderTris: number;
  buildings: number;
}

export class World {
  readonly group = new THREE.Group();
  readonly terrain: Terrain;
  readonly road: RoadNetwork;
  readonly collision = new CollisionWorld();
  vegetation!: Vegetation;
  birds!: Birds;
  collectibles!: Collectibles;
  interiors!: Interiors;

  /** Lamp heads that get a real point light after dark. */
  private lampPositions: THREE.Vector3[] = [];
  private lampLights: THREE.PointLight[] = [];
  private lampPools: THREE.InstancedMesh | null = null;

  readonly spawn = new THREE.Vector3();
  spawnFacing = 0;

  private keepouts: Keepout[] = [];
  private colliderMeshes: THREE.Mesh[] = [];
  private buildingCount = 0;
  private activePreset: QualityPreset;

  readonly interactables: Interactable[] = [];

  /** Set before build() so the interior windows become live portals. */
  portalMaterial: THREE.Material | undefined;

  constructor(
    private readonly assets: AssetBundle,
    private readonly preset: QualityPreset,
  ) {
    this.group.name = 'World';
    this.activePreset = preset;
    this.road = new RoadNetwork(WORLD_SIZE, naturalHeight);
    // Pads must exist before the terrain grid is computed — they are what
    // stops buildings hanging off the downhill side of a slope.
    this.terrain = new Terrain(
      this.road,
      PLACEMENTS.filter((p) => p.pad).map((p) => ({
        x: p.x,
        z: p.z,
        yaw: p.yaw,
        halfX: p.pad!.hx,
        halfZ: p.pad!.hz,
        blend: p.pad!.blend ?? 4,
      })),
    );
  }

  build(): void {
    const terrainMesh = this.terrain.build();
    this.group.add(terrainMesh);
    this.colliderMeshes.push(terrainMesh);

    const roads = buildRoadMeshes(this.road, (x, z) => this.terrain.heightAt(x, z));
    this.group.add(roads.group);

    this.placeBuildings();
    this.placeStreetFurniture();
    this.buildVegetation();
    this.buildBirds();
    this.buildCollectibles();

    // The interior cell shares the one static BVH — it just lives 600 m up.
    this.interiors = new Interiors(this.assets.buildings.get('RoomInterior'), this.portalMaterial);
    this.group.add(this.interiors.group);
    this.colliderMeshes.push(...this.interiors.colliders);
    this.interactables.push({
      position: this.interiors.exit.clone(),
      radius: 5.4,
      kind: 'exit',
      prompt: 'Step back outside',
    });
    this.interactables.push({
      position: this.interiors.bed.clone(),
      radius: 2.4,
      kind: 'sleep',
      prompt: 'Sleep until morning',
    });
    this.interactables.push({
      position: this.interiors.chair.clone().setY(this.interiors.chair.y + 0.9),
      radius: 1.9,
      kind: 'sit',
      prompt: 'Sit down',
    });
    this.interactables.push({
      position: this.interiors.wardrobe.clone(),
      radius: 2.3,
      kind: 'wardrobe',
      prompt: 'Open the wardrobe',
    });

    this.rebuildCollision();

    // Spawn on the road, facing up the hill toward the barrier.
    const p = this.road.pointOnMain(0.60);
    this.spawn.set(p.pos.x, this.terrain.heightAt(p.pos.x, p.pos.z) + 0.05, p.pos.z);
    this.spawnFacing = Math.PI;
  }

  // ------------------------------------------------------------------ props

  private instantiate(model: string): THREE.Object3D | null {
    const proto = this.assets.props.get(model) ?? this.assets.buildings.get(model);
    if (!proto) return null;
    const obj = proto.clone(true);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const m = mesh.material;
      mesh.material = Array.isArray(m)
        ? m.map((mm) => toonFromImported(mm, model))
        : toonFromImported(m as THREE.Material, model);
    });
    return obj;
  }

  private addCollider(
    x: number,
    y: number,
    z: number,
    yaw: number,
    hx: number,
    hy: number,
    hz: number,
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.updateMatrixWorld(true);
    this.colliderMeshes.push(mesh);
  }

  /** Local (x, z) offset rotated by yaw into world space. */
  private localToWorld(p: Placement, lx: number, lz: number): [number, number] {
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
  }

  private placeBuildings(): void {
    for (const p of PLACEMENTS) {
      const obj = this.instantiate(p.model);
      if (!obj) continue;
      // The pad under the footprint is level, so the centre height seats every
      // corner of the building at once.
      const y = this.terrain.heightAt(p.x, p.z) + (p.lift ?? 0);
      obj.position.set(p.x, y, p.z);
      obj.rotation.y = p.yaw;
      obj.updateMatrixWorld(true);
      this.group.add(obj);
      this.buildingCount++;

      if (p.keepout) this.keepouts.push({ x: p.x, z: p.z, radius: p.keepout });

      if (p.collider) {
        const c = p.collider;
        const oz = c.oz ?? 0;
        this.addCollider(
          p.x + Math.sin(p.yaw) * oz,
          y + (c.oy ?? c.hy),
          p.z + Math.cos(p.yaw) * oz,
          p.yaw,
          c.hx,
          c.hy,
          c.hz,
        );
      }

      // A foundation skirt under the footprint. The terrain grid is ~2 m per
      // cell, so a levelled pad can still alias by a few centimetres at the
      // corners; a block extending down from the pad guarantees the building
      // never reads as floating, whatever the ground does.
      //
      // Size it off the collider — that is the building's own box. The pad is
      // deliberately larger, and a skirt cut to the pad juts out past the walls
      // as a ledge. Both half-extents are in the placement's local frame, so
      // hx is the box's X and hz its Z; the mesh then takes the same yaw.
      if (p.skirt && (p.collider || p.pad)) {
        const hx = p.collider ? p.collider.hx + 0.1 : p.pad!.hx * 0.97;
        const hz = p.collider ? p.collider.hz + 0.1 : p.pad!.hz * 0.97;
        const skirt = new THREE.Mesh(
          new THREE.BoxGeometry(hx * 2, p.skirt, hz * 2),
          makeToon(0xb4a892, { id: 'foundation' }),
        );
        const soz = p.collider?.oz ?? 0;
        skirt.position.set(
          p.x + Math.sin(p.yaw) * soz,
          y - p.skirt / 2 + 0.12,
          p.z + Math.cos(p.yaw) * soz,
        );
        skirt.rotation.y = p.yaw;
        skirt.receiveShadow = true;
        skirt.updateMatrixWorld(true);
        this.group.add(skirt);
      }

      if (p.door) {
        const [dx, dz] = this.localToWorld(p, p.door.x, p.door.z);
        this.interactables.push({
          position: new THREE.Vector3(dx, y + 1.0, dz),
          radius: 2.4,
          kind: 'enter',
          prompt: 'Go inside',
        });
      }
    }

    for (const w of WALLS) {
      const obj = this.instantiate('RetainWall');
      if (!obj) continue;
      const y = this.terrain.heightAt(w.x, w.z) - 0.4;
      obj.position.set(w.x, y, w.z);
      obj.rotation.y = w.yaw + HALF_PI;
      obj.updateMatrixWorld(true);
      this.group.add(obj);
      this.addCollider(w.x, y + 1.2, w.z, w.yaw + HALF_PI, 0.32, 1.3, 3.0);
      this.keepouts.push({ x: w.x, z: w.z, radius: 3.4 });
    }

    for (const f of FENCES) {
      const obj = this.instantiate('FenceSection');
      if (!obj) continue;
      const y = this.terrain.heightAt(f.x, f.z);
      obj.position.set(f.x, y, f.z);
      obj.rotation.y = f.yaw + HALF_PI;
      obj.updateMatrixWorld(true);
      this.group.add(obj);
      this.addCollider(f.x, y + 0.8, f.z, f.yaw + HALF_PI, 0.16, 0.85, 2.0);
    }

    // Culvert set into the bank opposite the solar house.
    const cul = this.instantiate('Culvert');
    if (cul) {
      cul.position.set(13.4, this.terrain.heightAt(13.4, 44) - 0.25, 44);
      cul.rotation.y = Math.PI;
      cul.updateMatrixWorld(true);
      this.group.add(cul);
      this.keepouts.push({ x: 13.4, z: 44, radius: 3.0 });
    }

    // The road-closed barrier that caps the far end of the climb.
    const barrierZ = -118;
    const bp = this.nearestRoadPoint(barrierZ);
    const barrier = this.instantiate('Barrier');
    if (barrier) {
      barrier.position.set(bp.x, this.terrain.heightAt(bp.x, bp.z), bp.z);
      barrier.rotation.y = bp.yaw;
      barrier.updateMatrixWorld(true);
      this.group.add(barrier);
      this.addCollider(bp.x, this.terrain.heightAt(bp.x, bp.z) + 0.75, bp.z, bp.yaw, 3.4, 0.8, 0.3);
    }
  }

  private nearestRoadPoint(z: number): { x: number; z: number; yaw: number; index: number } {
    const pts = this.road.main.pts;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const t = this.road.main.tangents[best];
    return { x: pts[best].x, z: pts[best].z, yaw: Math.atan2(t.x, t.y) + HALF_PI, index: best };
  }

  /** Streetlights, utility poles, the cables between them, bench and mailbox. */
  private placeStreetFurniture(): void {
    const rng = new Rng(606060);
    const main = this.road.main;
    const lampTops: THREE.Vector3[] = [];
    const poleTops: THREE.Vector3[] = [];

    const step = 15; // polyline indices between lamps (~26 m)
    let side = 1;
    for (let i = 12; i < main.pts.length - 14; i += step) {
      const p = main.pts[i];
      const t = main.tangents[i];
      const off = side * (ROAD_HALF_WIDTH + SHOULDER_WIDTH + 0.7);
      const x = p.x + -t.y * off;
      const z = p.z + t.x * off;
      const y = this.terrain.heightAt(x, z);

      const lamp = this.instantiate('Streetlight');
      if (lamp) {
        lamp.position.set(x, y, z);
        // Arms sweep over the carriageway.
        lamp.rotation.y = Math.atan2(-t.y, t.x) + (side > 0 ? Math.PI : 0);
        lamp.updateMatrixWorld(true);
        this.group.add(lamp);
        this.addCollider(x, y + 2.2, z, 0, 0.22, 2.2, 0.22);
        const tip = new THREE.Vector3(x, y + 6.9, z);
        lampTops.push(tip);
        this.lampPositions.push(
          new THREE.Vector3(x - -t.y * side * 2.0, y + 6.75, z - t.x * side * 2.0),
        );
      }
      side *= -1;
    }

    // Utility poles run down one side only, carrying the overhead cables.
    for (let i = 6; i < main.pts.length - 8; i += 22) {
      const p = main.pts[i];
      const t = main.tangents[i];
      const off = -(ROAD_HALF_WIDTH + SHOULDER_WIDTH + 2.6);
      const x = p.x + -t.y * off;
      const z = p.z + t.x * off;
      const y = this.terrain.heightAt(x, z);
      const pole = this.instantiate('UtilityPole');
      if (!pole) continue;
      pole.position.set(x, y, z);
      pole.rotation.y = Math.atan2(t.x, t.y);
      pole.updateMatrixWorld(true);
      this.group.add(pole);
      this.addCollider(x, y + 2.4, z, 0, 0.24, 2.4, 0.24);
      poleTops.push(new THREE.Vector3(x, y + 8.35, z));
      poleTops.push(new THREE.Vector3(x, y + 7.35, z));
      this.keepouts.push({ x, z, radius: 2.2 });
    }

    this.buildCables(poleTops, lampTops);
    this.buildLampPools();

    // Bench and mailbox, placed against specific buildings.
    const bench = this.instantiate('Bench');
    if (bench) {
      bench.position.set(11.4, this.terrain.heightAt(11.4, 20), 20);
      bench.rotation.y = -HALF_PI;
      bench.updateMatrixWorld(true);
      this.group.add(bench);
      this.addCollider(11.4, this.terrain.heightAt(11.4, 20) + 0.35, 20, -HALF_PI, 0.9, 0.35, 0.3);
    }
    for (const [x, z] of [[-10.2, 60], [10.6, 33], [12.4, -22]] as Array<[number, number]>) {
      const mb = this.instantiate('Mailbox');
      if (!mb) continue;
      mb.position.set(x, this.terrain.heightAt(x, z), z);
      mb.rotation.y = x < 0 ? HALF_PI : -HALF_PI;
      mb.updateMatrixWorld(true);
      this.group.add(mb);
    }
    for (let i = 0; i < 6; i++) {
      const b = this.instantiate('Bollard');
      if (!b) continue;
      const idx = 30 + i * 9;
      if (idx >= main.pts.length) break;
      const p = main.pts[idx];
      const t = main.tangents[idx];
      const off = ROAD_HALF_WIDTH + SHOULDER_WIDTH + 0.3;
      const x = p.x + -t.y * off + rng.jitter(0.2);
      const z = p.z + t.x * off;
      b.position.set(x, this.terrain.heightAt(x, z), z);
      b.updateMatrixWorld(true);
      this.group.add(b);
    }
  }

  /** Catenary cables strung between pole tops and lamp heads. */
  private buildCables(poleTops: THREE.Vector3[], lampTops: THREE.Vector3[]): void {
    const parts: THREE.BufferGeometry[] = [];

    const span = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      const pts: THREE.Vector3[] = [];
      const seg = 10;
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const p = a.clone().lerp(b, t);
        // parabolic approximation of a catenary — visually identical at this scale
        p.y -= sag * 4 * t * (1 - t);
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      parts.push(new THREE.TubeGeometry(curve, seg, 0.035, 4, false));
    };

    // Poles were pushed in pairs (upper and lower crossarm).
    for (let i = 0; i + 3 < poleTops.length; i += 2) {
      span(poleTops[i], poleTops[i + 2], 0.85);
      span(poleTops[i + 1], poleTops[i + 3], 0.95);
      // a third, slightly offset line for visual density
      span(
        poleTops[i].clone().add(new THREE.Vector3(0.55, -0.35, 0)),
        poleTops[i + 2].clone().add(new THREE.Vector3(0.55, -0.35, 0)),
        1.05,
      );
    }
    // Service drops toward the lamp columns.
    for (let i = 0; i + 1 < lampTops.length; i += 2) {
      span(lampTops[i], lampTops[i + 1], 1.25);
    }

    if (!parts.length) return;
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) return;
    const cables = new THREE.Mesh(merged, makeToon(0x3a3a38));
    cables.name = 'Cables';
    cables.castShadow = true;
    cables.receiveShadow = false;
    this.group.add(cables);
  }

  /** Soft additive pools under each lamp, cheaper than a light per column. */
  private buildLampPools(): void {
    if (!this.lampPositions.length) return;
    // A flat disc reads as a painted circle. The falloff texture is what
    // makes it read as light spilling onto the road.
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.32, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.62, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const falloff = new THREE.CanvasTexture(cv);
    falloff.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.PlaneGeometry(13, 13);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: falloff,
      color: 0xffca7e,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    const inst = new THREE.InstancedMesh(geo, mat, this.lampPositions.length);
    inst.name = 'LampPools';
    inst.renderOrder = 3;
    inst.frustumCulled = false;
    const m = new THREE.Matrix4();
    this.lampPositions.forEach((p, i) => {
      m.makeTranslation(p.x, this.terrain.heightAt(p.x, p.z) + 0.06, p.z);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    this.lampPools = inst;
    this.group.add(inst);

    // A small pool of real point lights, reassigned to whichever lamps are
    // nearest the player — 20 live lights would tank the forward renderer.
    const liveLights = this.preset.shadowsEnabled ? 4 : 2;
    for (let i = 0; i < liveLights; i++) {
      const l = new THREE.PointLight(0xffcf8c, 0, 17, 1.7);
      l.castShadow = false;
      l.visible = false;
      this.lampLights.push(l);
      this.group.add(l);
    }
  }

  // ------------------------------------------------------------ vegetation

  private buildVegetation(): void {
    const proto = {} as VegetationPrototypes;
    for (const key of [
      'TreeBig', 'TreeMed', 'TreeSmall', 'Palm', 'DeadTree',
      'BushA', 'BushB', 'RockA', 'RockB', 'RockC', 'GrassTuft',
    ] as const) {
      const o = this.assets.nature.get(key);
      if (o) proto[key] = o;
    }
    if (!proto.TreeBig) return;

    this.vegetation = new Vegetation(
      proto,
      { terrain: this.terrain, road: this.road, keepouts: this.keepouts },
      this.activePreset.vegetationDensity,
      this.activePreset.grassDensity,
    );
    this.vegetation.build();
    this.group.add(this.vegetation.group);
  }

  private buildBirds(): void {
    this.birds = new Birds(this.preset.birdCount);
    this.group.add(this.birds.mesh);
  }

  // ----------------------------------------------------------- collectibles

  private collectibleDefs(): CollectibleDef[] {
    const h = (x: number, z: number, up: number) =>
      new THREE.Vector3(x, this.terrain.heightAt(x, z) + up, z);
    return [
      {
        id: 'paper-plane',
        model: 'PaperPlane',
        label: 'Paper aeroplane',
        found: 'A paper aeroplane, nose-down in the grass.',
        position: h(21.6, 9.5, 0.95),
        scale: 1.0,
        spin: true,
      },
      {
        id: 'toy-boat',
        model: 'ToyBoat',
        label: 'Toy boat',
        found: 'Someone sailed this as far as the culvert.',
        position: h(12.2, 46.5, 0.55),
        scale: 1.0,
        spin: true,
      },
      {
        id: 'wind-chime',
        model: 'WindChime',
        label: 'Wind chime',
        found: 'Wind chime, still faintly ringing.',
        position: h(-11.6, 62.5, 1.35),
        scale: 1.0,
        spin: false,
      },
      {
        id: 'old-camera',
        model: 'OldCamera',
        label: 'Old camera',
        found: 'An old camera, left on the bench.',
        position: h(11.4, 20.0, 0.80),
        scale: 1.0,
        spin: true,
      },
      {
        id: 'star-ornament',
        model: 'StarOrnament',
        label: 'Star ornament',
        found: 'A little brass star, right at the end of the road.',
        position: h(-6.0, -112.0, 0.85),
        scale: 1.0,
        spin: true,
      },
    ];
  }

  private buildCollectibles(): void {
    this.collectibles = new Collectibles(
      this.collectibleDefs(),
      this.assets.collectibles,
      { onFound: (def, count, total) => this.onCollect?.(def, count, total) },
    );
    this.group.add(this.collectibles.group);
  }

  onCollect: ((def: CollectibleDef, count: number, total: number) => void) | null = null;

  // ------------------------------------------------------------------ frame

  update(dt: number, elapsed: number, player: THREE.Vector3, cameraPos: THREE.Vector3,
         lampFactor: number): void {
    this.birds?.update(dt, elapsed, cameraPos);
    this.collectibles?.update(dt, player);
    this.updateLamps(player, lampFactor);
  }

  private updateLamps(player: THREE.Vector3, lampFactor: number): void {
    if (this.lampPools) {
      const mat = this.lampPools.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.42 * lampFactor;
      this.lampPools.visible = lampFactor > 0.02;
    }
    if (!this.lampLights.length) return;

    if (lampFactor < 0.05) {
      for (const l of this.lampLights) l.visible = false;
      return;
    }

    // Assign the light pool to the nearest lamp columns each frame.
    const ranked = this.lampPositions
      .map((p, i) => ({ i, d: p.distanceToSquared(player) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.lampLights.length);

    this.lampLights.forEach((light, n) => {
      const pick = ranked[n];
      if (!pick || pick.d > 62 * 62) {
        light.visible = false;
        return;
      }
      light.position.copy(this.lampPositions[pick.i]);
      light.visible = true;
      light.intensity = 16 * lampFactor;
    });
  }

  /** Static colliders plus whatever vegetation currently contributes. */
  private rebuildCollision(): void {
    this.collision.build([
      ...this.colliderMeshes,
      ...(this.vegetation?.propColliders ?? []),
    ]);
  }

  applyQuality(preset: QualityPreset): void {
    this.birds?.setCount(preset.birdCount);

    const densityChanged =
      preset.vegetationDensity !== this.activePreset.vegetationDensity ||
      preset.grassDensity !== this.activePreset.grassDensity;
    this.activePreset = preset;
    if (!densityChanged || !this.vegetation) return;

    // Re-instancing the whole vegetation set costs a beat, but it is the only
    // way the density slider means anything without a reload. Rebuilding the
    // BVH afterwards matters too: trunk and boulder proxies come with it.
    this.vegetation.group.removeFromParent();
    this.vegetation.dispose();
    this.buildVegetation();
    this.rebuildCollision();
  }

  /** Thinned road centrelines and building footprints, for the radar. */
  get mapData(): {
    roads: Array<Array<{ x: number; z: number }>>;
    buildings: Array<{ x: number; z: number; r: number }>;
  } {
    const thin = (pts: THREE.Vector3[], step: number) =>
      pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => ({ x: p.x, z: p.z }));
    return {
      roads: [thin(this.road.main.pts, 6), thin(this.road.side.pts, 6)],
      buildings: PLACEMENTS.map((p) => ({
        x: p.x,
        z: p.z,
        r: Math.max(p.pad?.hx ?? 3, p.pad?.hz ?? 3) * 0.82,
      })),
    };
  }

  /** Keepsake positions and whether each has been found. */
  get keepsakeMarkers(): Array<{ x: number; z: number; found: boolean }> {
    return this.collectibles.markers;
  }

  /** Surface under a point: 1 = tarmac, 0 = grass. */
  surfaceHardness(x: number, z: number): number {
    return this.road.surfaceHardness(x, z);
  }

  inBounds = (x: number, z: number): boolean => this.terrain.isInside(x, z, 4);

  get stats(): WorldStats {
    const v = this.vegetation?.stats ?? { instances: 0, grass: 0 };
    return {
      vegetation: v.instances,
      grass: v.grass,
      colliderTris: this.collision.triangleCount,
      buildings: this.buildingCount,
    };
  }

  dispose(): void {
    this.vegetation?.dispose();
    this.birds?.dispose();
    this.collectibles?.dispose();
    this.collision.dispose();
    this.lampPools?.geometry.dispose();
    (this.lampPools?.material as THREE.Material | undefined)?.dispose();
    this.group.removeFromParent();
  }
}
