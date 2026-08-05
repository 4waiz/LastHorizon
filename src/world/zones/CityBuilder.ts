import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeToon } from '../../graphics/ToonMaterial';
import type { DisposalRegistry } from '../../core/DisposalRegistry';
import type { ChunkManifest, ZoneManifest } from './Manifest';

/**
 * Procedural city geometry.
 *
 * Generated from primitives in the existing toon palette — no unique Blender
 * buildings. A district is a grid of 48 m chunks; each chunk decides its
 * contents from its coordinate (roads follow fixed axes) and its deterministic
 * seed (everything else), so a chunk builds identically on every machine.
 *
 * Geometry is merged per material within a chunk before it reaches the scene.
 * Thirty loose boxes would be thirty draw calls; merged by material it is a
 * handful, which is what keeps a streamed district inside the draw-call budget
 * in docs/PERFORMANCE_BUDGETS.md.
 */

/** Muted and warm, to sit beside the village rather than fight it. */
const PALETTE = {
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
};

/**
 * Street layout constants. Exported because `CityRuntime` answers ground
 * height and surface hardness from the same numbers — two copies would drift
 * and the player would hear grass while standing on tarmac.
 */
export const ROAD_HALF = 5.0;
export const SIDEWALK_W = 2.2;
export const KERB_H = 0.14;

/**
 * Deterministic per-chunk RNG. Local, so chunk contents never depend on global
 * state or on the order chunks happen to stream in.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A box, positioned by its centre, ready to merge. */
function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Accumulates geometry per palette colour so each colour becomes one mesh. */
class Batch {
  private readonly byColor = new Map<number, THREE.BufferGeometry[]>();

  add(color: number, geo: THREE.BufferGeometry): void {
    const list = this.byColor.get(color);
    if (list) list.push(geo);
    else this.byColor.set(color, [geo]);
  }

  /**
   * Merge each colour group into a single mesh, register both geometry and
   * the parent link for disposal, and attach to `parent`.
   *
   * Materials come from `makeToon`, which caches by value — so the city reuses
   * the village's programs rather than compiling its own.
   */
  flush(parent: THREE.Object3D, scope: DisposalRegistry, label: string): number {
    let meshes = 0;
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
      meshes++;

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

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

type Bounds = ChunkManifest['bounds'];

/**
 * Clip a world-space rect to a chunk's bounds.
 *
 * Roads are authored as continuous world-space strips, and each chunk emits
 * only the part that falls inside it. That is what keeps a carriageway
 * seamless across a chunk seam: neighbouring chunks contribute abutting
 * pieces of one strip rather than each guessing where the road should be.
 */
function clip(b: Bounds, r: Rect): Rect | null {
  const x0 = Math.max(b.minX, r.x0);
  const x1 = Math.min(b.maxX, r.x1);
  const z0 = Math.max(b.minZ, r.z0);
  const z1 = Math.min(b.maxZ, r.z1);
  if (x1 - x0 <= 1e-4 || z1 - z0 <= 1e-4) return null;
  return { x0, z0, x1, z1 };
}

/** A flat slab covering `r`, `thickness` tall, sitting with its top at `y`. */
function slab(batch: Batch, color: number, r: Rect, y: number, thickness: number): void {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  batch.add(color, box(w, thickness, d, (r.x0 + r.x1) / 2, y - thickness / 2, (r.z0 + r.z1) / 2));
}

/** Where the carriageways run, in world space. Lanes in the manifest match. */
export const MAIN_ROAD_X = 0;
export const SIDE_STREET_Z = 0;

function onMainRoad(b: Bounds): boolean {
  return b.minX <= MAIN_ROAD_X + ROAD_HALF && b.maxX >= MAIN_ROAD_X - ROAD_HALF;
}

function onSideStreet(b: Bounds): boolean {
  return b.minZ <= SIDE_STREET_Z + ROAD_HALF && b.maxZ >= SIDE_STREET_Z - ROAD_HALF;
}

/** Road surface, kerbs, sidewalks and centre dashes for one chunk. */
function emitRoads(batch: Batch, b: Bounds): void {
  const FAR = 1e4;

  const strips: Rect[] = [];
  if (onMainRoad(b)) {
    strips.push({ x0: MAIN_ROAD_X - ROAD_HALF, x1: MAIN_ROAD_X + ROAD_HALF, z0: -FAR, z1: FAR });
  }
  if (onSideStreet(b)) {
    strips.push({ x0: -FAR, x1: FAR, z0: SIDE_STREET_Z - ROAD_HALF, z1: SIDE_STREET_Z + ROAD_HALF });
  }

  for (const s of strips) {
    const c = clip(b, s);
    if (c) slab(batch, PALETTE.road, c, 0.02, 0.2);
  }

  // Sidewalks flank each carriageway, raised by a kerb.
  const walks: Rect[] = [];
  if (onMainRoad(b)) {
    walks.push(
      { x0: MAIN_ROAD_X - ROAD_HALF - SIDEWALK_W, x1: MAIN_ROAD_X - ROAD_HALF, z0: -FAR, z1: FAR },
      { x0: MAIN_ROAD_X + ROAD_HALF, x1: MAIN_ROAD_X + ROAD_HALF + SIDEWALK_W, z0: -FAR, z1: FAR },
    );
  }
  if (onSideStreet(b)) {
    walks.push(
      { x0: -FAR, x1: FAR, z0: SIDE_STREET_Z - ROAD_HALF - SIDEWALK_W, z1: SIDE_STREET_Z - ROAD_HALF },
      { x0: -FAR, x1: FAR, z0: SIDE_STREET_Z + ROAD_HALF, z1: SIDE_STREET_Z + ROAD_HALF + SIDEWALK_W },
    );
  }
  for (const w of walks) {
    const c = clip(b, w);
    if (c) slab(batch, PALETTE.sidewalk, c, KERB_H, 0.28);
  }

  // Centre dashes on the main road, on a fixed world grid so they line up
  // across chunk seams instead of restarting at each boundary.
  if (onMainRoad(b)) {
    const step = 8;
    const first = Math.ceil(b.minZ / step) * step;
    for (let z = first; z < b.maxZ; z += step) {
      const seg = clip(b, { x0: -0.18, x1: 0.18, z0: z, z1: z + 3.2 });
      if (seg) slab(batch, PALETTE.marking, seg, 0.05, 0.06);
    }
  }

  // A crossing where the two roads meet.
  if (onMainRoad(b) && onSideStreet(b)) {
    for (let i = 0; i < 5; i++) {
      const x = MAIN_ROAD_X - ROAD_HALF + 0.8 + i * 2.1;
      const bar = clip(b, {
        x0: x,
        x1: x + 1.1,
        z0: SIDE_STREET_Z + ROAD_HALF + 0.6,
        z1: SIDE_STREET_Z + ROAD_HALF + 4.2,
      });
      if (bar) slab(batch, PALETTE.marking, bar, 0.05, 0.06);
    }
  }
}

/** The four service shells the phase calls for, as silhouettes. */
const SHELLS = [
  { id: 'grocery', w: 15, d: 11, h: 5.2, wall: PALETTE.wallWarm, roof: PALETTE.roofRed },
  { id: 'police', w: 17, d: 13, h: 7.4, wall: PALETTE.wallCool, roof: PALETTE.roofDark },
  { id: 'apartment', w: 13, d: 13, h: 15.0, wall: PALETTE.wallPink, roof: PALETTE.roofDark },
  { id: 'garage', w: 16, d: 12, h: 4.6, wall: PALETTE.wallCool, roof: PALETTE.metal },
] as const;

const ROAD_KEEPOUT = ROAD_HALF + SIDEWALK_W + 2.5;

/** True if a footprint centred here would sit on a carriageway or its walk. */
function clearOfRoads(x: number, z: number, w: number, d: number): boolean {
  const nearMain = Math.abs(x - MAIN_ROAD_X) < ROAD_KEEPOUT + w / 2;
  const nearSide = Math.abs(z - SIDE_STREET_Z) < ROAD_KEEPOUT + d / 2;
  return !nearMain && !nearSide;
}

/**
 * A building shell: base, banded upper storey, roof slab and a shopfront
 * glass strip. Deliberately a silhouette — interiors arrive in Phase 7.
 */
function emitShell(
  batch: Batch,
  shell: (typeof SHELLS)[number],
  x: number,
  z: number,
  rot: boolean,
): void {
  const w = rot ? shell.d : shell.w;
  const d = rot ? shell.w : shell.d;

  batch.add(shell.wall, box(w, shell.h, d, x, shell.h / 2, z));
  // Roof slab, slightly proud so it reads as an eave.
  batch.add(shell.roof, box(w + 0.7, 0.5, d + 0.7, x, shell.h + 0.25, z));
  // Shopfront glazing on the long face.
  batch.add(PALETTE.glass, box(w * 0.72, 1.9, 0.16, x, 1.7, z - d / 2 - 0.02));
  // A sign band above it.
  batch.add(shell.roof, box(w * 0.5, 0.55, 0.22, x, 3.5, z - d / 2 - 0.04));

  // Upper-storey windows, evenly spaced, for anything tall enough.
  if (shell.h > 6) {
    const rows = Math.floor((shell.h - 4.5) / 3.2);
    for (let r = 0; r < rows; r++) {
      for (let i = -1; i <= 1; i++) {
        batch.add(
          PALETTE.glass,
          box(1.5, 1.2, 0.14, x + i * (w / 3.4), 5.6 + r * 3.2, z - d / 2 - 0.02),
        );
      }
    }
  }
}

/** Streetlights on a fixed world grid, so they align across chunk seams. */
function emitStreetlights(batch: Batch, b: Bounds): void {
  if (!onMainRoad(b)) return;
  const step = 16;
  const first = Math.ceil(b.minZ / step) * step;
  for (let z = first; z < b.maxZ; z += step) {
    for (const side of [-1, 1]) {
      const x = MAIN_ROAD_X + side * (ROAD_HALF + SIDEWALK_W * 0.55);
      batch.add(PALETTE.metal, box(0.22, 6.0, 0.22, x, 3.0, z));
      batch.add(PALETTE.metal, box(2.2, 0.16, 0.16, x - side * 1.0, 5.95, z));
    }
  }
}

/** Parking bays and a couple of utility poles on the block side. */
function emitParking(batch: Batch, b: Bounds, rand: () => number): void {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const x = cx + (rand() - 0.5) * 10;
  const z = cz + (rand() - 0.5) * 10;
  if (!clearOfRoads(x, z, 16, 12)) return;

  for (let i = 0; i < 4; i++) {
    batch.add(PALETTE.marking, box(0.14, 0.06, 5.0, x + i * 2.8, 0.06, z));
  }
  batch.add(PALETTE.metal, box(0.26, 5.2, 0.26, x - 2.0, 2.6, z + 3.4));
}

/** Calm water for the waterfront district. */
function emitWater(batch: Batch, b: Bounds): void {
  const c = clip(b, { x0: -1e4, x1: 1e4, z0: -1e4, z1: -120 });
  if (c) slab(batch, PALETTE.water, c, -0.4, 0.5);
}

/**
 * Build one city chunk. Everything created is registered into `scope`, which
 * the ZoneManager disposes when the chunk unloads.
 */
export function buildCityChunk(
  zone: ZoneManifest,
  chunk: ChunkManifest,
  scope: DisposalRegistry,
  parent: THREE.Object3D,
): number {
  const rand = mulberry32(chunk.seed);
  const batch = new Batch();
  const b = chunk.bounds;

  // Ground plate for the whole chunk, so blocks are never see-through.
  slab(batch, PALETTE.sidewalk, { x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.maxZ }, 0, 0.4);

  emitRoads(batch, b);
  emitStreetlights(batch, b);
  if (zone.id === 'city_waterfront') emitWater(batch, b);

  // Two candidate building slots per chunk, offset into opposite quadrants.
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const slots: Array<[number, number]> = [
    [cx - 12, cz - 12],
    [cx + 12, cz + 12],
  ];
  for (const [sx, sz] of slots) {
    const shell = SHELLS[Math.floor(rand() * SHELLS.length)];
    const jitterX = sx + (rand() - 0.5) * 3;
    const jitterZ = sz + (rand() - 0.5) * 3;
    if (!clearOfRoads(jitterX, jitterZ, shell.w, shell.d)) continue;
    emitShell(batch, shell, jitterX, jitterZ, rand() > 0.5);
  }

  emitParking(batch, b, rand);

  return batch.flush(parent, scope, `chunk_${chunk.coord.cx}_${chunk.coord.cz}`);
}

/**
 * Always-resident district dressing: a cheap skyline ring beyond the playable
 * bounds. Impostor boxes, no detail — they exist to close the horizon so the
 * streamed area does not end in empty sky.
 */
export function buildCitySkyline(
  zone: ZoneManifest,
  scope: DisposalRegistry,
  parent: THREE.Object3D,
): number {
  const rand = mulberry32(zone.seed);
  const batch = new Batch();
  const cx = (zone.bounds.minX + zone.bounds.maxX) / 2;
  const cz = (zone.bounds.minZ + zone.bounds.maxZ) / 2;
  const radius = Math.max(
    zone.bounds.maxX - zone.bounds.minX,
    zone.bounds.maxZ - zone.bounds.minZ,
  );

  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const r = radius * (0.62 + rand() * 0.22);
    const h = 18 + rand() * 46;
    const w = 10 + rand() * 16;
    batch.add(PALETTE.skyline, box(w, h, w, cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r));
  }

  return batch.flush(parent, scope, 'skyline');
}
