import type * as THREE from 'three';
import type { DisposalRegistry } from '../../core/DisposalRegistry';
import type { ZoneManifest } from './Manifest';
import { Batch, box, cylinder, inRect, mulberry32, ZONE_PALETTE, type Rect } from './GeoBatch';

/**
 * The hill airstrip, as geometry.
 *
 * Authored rather than streamed. It is one 190 m strip, an apron and two
 * buildings — a chunk grid over that would be four mostly-empty chunks and a
 * seam down the runway, which is the one place in this world a seam would
 * actually be visible from the air.
 *
 * **The layout is not free to move.** `CHECKPOINTS` in `src/flight/WorldBounds.ts`
 * already places `airstrip_apron` at (176, 0) and `airstrip_hold` at (152, -18),
 * and those are where a recovered aeroplane is put back. Both must land on
 * tarmac, and `airstrip.test.ts` asserts exactly that — a checkpoint in the
 * grass is a recovery that needs another recovery.
 */

const P = ZONE_PALETTE;

/** Paved surfaces, in world space. Exported: the runtime answers footsteps
 *  and the map from these same rectangles rather than a second copy. */
export const RUNWAY: Rect = { x0: 150, z0: -41, x1: 340, z1: -19 };
export const APRON: Rect = { x0: 154, z0: -6, x1: 206, z1: 16 };
/** The hold, at the western threshold. `airstrip_hold` sits on it. */
export const TAXI_WEST: Rect = { x0: 146, z0: -19, x1: 164, z1: -6 };
/** Mid-field link, so a taxiing aeroplane is not forced back to the threshold. */
export const TAXI_MID: Rect = { x0: 171, z0: -19, x1: 181, z1: -6 };

export const PAVED: readonly Rect[] = [RUNWAY, APRON, TAXI_WEST, TAXI_MID];

/** Runway centreline and heading. The strip runs east, facing +X. */
export const RUNWAY_Z = (RUNWAY.z0 + RUNWAY.z1) / 2;
export const RUNWAY_HEADING = Math.PI / 2;

export interface AirstripBuilding {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Half-diagonal footprint radius, for the map. */
  readonly r: number;
}

/**
 * The two structures, as data.
 *
 * Exported for the same reason `cityChunkBuildings` is: the geometry and the
 * map read one source. A map that derives footprints separately is how a map
 * ends up showing a hangar that is not there.
 */
export const BUILDINGS: readonly AirstripBuilding[] = [
  { id: 'hangar', x: 214, z: 6, w: 18, d: 16, h: 8.0, r: 12.0 },
  { id: 'office', x: 166, z: 12, w: 9, d: 7, h: 4.2, r: 5.7 },
];

/** Where the office door is, on the apron side of the office. */
export const OFFICE_DOOR = { x: 166, z: 12 - 7 / 2 - 0.4 };

/** True if this point is on tarmac. */
export function onPaved(x: number, z: number): boolean {
  for (const r of PAVED) if (inRect(r, x, z)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Threshold bars, six per end, the way a real strip marks its usable start. */
function emitThresholds(batch: Batch): void {
  for (const end of [RUNWAY.x0, RUNWAY.x1] as const) {
    const dir = end === RUNWAY.x0 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      const z = RUNWAY_Z - 8.5 + i * 3.4;
      batch.slab(
        P.marking,
        { x0: end + dir * 2, z0: z, x1: end + dir * 11, z1: z + 1.5 },
        0.06,
        0.06,
      );
    }
  }
}

/** Centreline dashes on a fixed world grid, so they never restart mid-strip. */
function emitCentreline(batch: Batch): void {
  const step = 16;
  for (let x = RUNWAY.x0 + 20; x < RUNWAY.x1 - 20; x += step) {
    batch.slab(
      P.marking,
      { x0: x, z0: RUNWAY_Z - 0.35, x1: x + 8, z1: RUNWAY_Z + 0.35 },
      0.06,
      0.06,
    );
  }
}

/** Edge markers down both sides. Cheap boxes; they read as cones from the air. */
function emitEdgeMarkers(batch: Batch): void {
  for (let x = RUNWAY.x0 + 10; x < RUNWAY.x1; x += 20) {
    for (const z of [RUNWAY.z0 - 1.2, RUNWAY.z1 + 1.2]) {
      batch.add(P.marking, box(0.5, 0.7, 0.5, x, 0.35, z));
    }
  }
}

/**
 * A hangar: three walls, an open front facing the apron, and a roof.
 *
 * Open-fronted deliberately. A closed box would be a shed, and the one thing
 * the player needs to read from a thousand feet is "that is where aeroplanes
 * go".
 */
function emitHangar(batch: Batch, b: AirstripBuilding): void {
  const hw = b.w / 2;
  const hd = b.d / 2;
  const t = 0.4;

  // Back and two sides. The front (-Z, toward the apron) is left open.
  batch.add(P.metal, box(b.w, b.h, t, b.x, b.h / 2, b.z + hd));
  batch.add(P.metal, box(t, b.h, b.d, b.x - hw, b.h / 2, b.z));
  batch.add(P.metal, box(t, b.h, b.d, b.x + hw, b.h / 2, b.z));
  // Roof, proud on every edge so it reads as an eave rather than a lid.
  batch.add(P.roofDark, box(b.w + 1.2, 0.5, b.d + 1.2, b.x, b.h + 0.25, b.z));
  // A lintel across the opening, so the front edge has a line.
  batch.add(P.metal, box(b.w, 0.9, t, b.x, b.h - 0.45, b.z - hd));
}

/** The office: a low block with a door, a window strip and a mast. */
function emitOffice(batch: Batch, b: AirstripBuilding): void {
  const hd = b.d / 2;

  batch.add(P.wallWarm, box(b.w, b.h, b.d, b.x, b.h / 2, b.z));
  batch.add(P.roofDark, box(b.w + 0.7, 0.45, b.d + 0.7, b.x, b.h + 0.22, b.z));
  // Glazing along the apron face, so somebody inside can watch the strip.
  batch.add(P.glass, box(b.w * 0.66, 1.3, 0.14, b.x, 2.4, b.z - hd - 0.02));
  // The door itself, a darker panel offset from the glass.
  batch.add(P.roofDark, box(1.2, 2.2, 0.18, b.x, 1.1, b.z - hd - 0.03));
  // Radio mast, and a crossarm so it is not just a stick.
  batch.add(P.metal, cylinder(0.14, 9, b.x + b.w / 2 + 1.4, 4.5, b.z, 6));
  batch.add(P.metal, box(2.0, 0.12, 0.12, b.x + b.w / 2 + 1.4, 8.4, b.z));
}

/**
 * A windsock at the threshold.
 *
 * Not decoration: it is the only thing on the field that tells a pilot which
 * way the wind is before they commit to a takeoff run, and the flight model
 * has no wind vector to read otherwise.
 */
function emitWindsock(batch: Batch): void {
  const x = 146;
  const z = -8;
  batch.add(P.metal, cylinder(0.12, 6, x, 3, z, 6));
  batch.add(P.marking, box(0.9, 0.9, 0.9, x + 0.7, 5.6, z));
  batch.add(P.roofRed, box(1.4, 0.7, 0.7, x + 1.9, 5.6, z));
}

/** Perimeter fence posts, north of the apron and east of the hangar. */
function emitFence(batch: Batch): void {
  for (let x = 140; x <= 240; x += 6) {
    batch.add(P.metal, box(0.16, 1.5, 0.16, x, 0.75, 22));
  }
  for (let z = -46; z <= 22; z += 6) {
    batch.add(P.metal, box(0.16, 1.5, 0.16, 244, 0.75, z));
  }
}

/**
 * Dry scrub either side of the strip.
 *
 * Seeded from the zone, so the same tufts stand in the same places on every
 * machine — the airstrip is a screenshot baseline and a moving bush is a
 * false regression.
 */
function emitScrub(batch: Batch, zone: ZoneManifest): void {
  const rand = mulberry32(zone.seed);
  for (let i = 0; i < 90; i++) {
    const x = 132 + rand() * 240;
    const z = -120 + rand() * 240;
    if (onPaved(x, z)) continue;
    // Nothing inside a building footprint, or a bush grows through a wall.
    if (BUILDINGS.some((b) => Math.abs(x - b.x) < b.w && Math.abs(z - b.z) < b.d)) continue;
    const s = 0.6 + rand() * 0.9;
    batch.add(P.grassDry, box(s, s * 0.7, s, x, s * 0.35, z));
  }
}

/**
 * Build the airstrip. Everything created is registered into `scope`, which the
 * ZoneManager disposes when the zone is left.
 *
 * Returns the solid meshes, so the caller can hand them to collision. The
 * ground plate is included: without it the player falls through a field that
 * renders perfectly well.
 */
export function buildAirstrip(
  zone: ZoneManifest,
  scope: DisposalRegistry,
  parent: THREE.Object3D,
): THREE.Mesh[] {
  const batch = new Batch();
  const b = zone.bounds;

  // Ground plate across the whole zone, then tarmac laid on top of it.
  batch.slab(P.grassDry, { x0: b.minX, z0: b.minZ, x1: b.maxX, z1: b.maxZ }, 0, 0.5);
  for (const r of PAVED) batch.slab(P.road, r, 0.03, 0.22);

  emitThresholds(batch);
  emitCentreline(batch);
  emitEdgeMarkers(batch);
  emitWindsock(batch);
  emitFence(batch);
  emitScrub(batch, zone);

  for (const bld of BUILDINGS) {
    if (bld.id === 'hangar') emitHangar(batch, bld);
    else emitOffice(batch, bld);
  }

  return batch.flush(parent, scope, 'airstrip');
}
