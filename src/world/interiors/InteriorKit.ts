/**
 * The modular interior kit: what the parts are, and how big they are.
 *
 * `scripts/blender/build_interior_kit.py` authors the geometry; this file is
 * the contract the game reads it through. The grid constants appear in both
 * and `tests/interiorKit.test.ts` asserts the pair stay equal, because a
 * 2.0 m wall segment placed on a 2.1 m grid leaves a gap you can see through
 * and a collider you can walk through.
 *
 * ## Axes
 *
 * Blender is Z-up and the glTF exporter converts to Y-up, so a part authored
 * as (X, Y, Z) in Blender arrives as (X, Z, -Y) here. In practice:
 *
 * - a wall runs along **X**, is `WALL_T` thick in **Z**, `WALL_H` tall in Y;
 * - furniture faces **+Z** at yaw 0, with its origin on the floor.
 *
 * Nothing in this file reads a Three.js type. Colliders are plain numbers so
 * the whole layout pass is testable without a renderer.
 */

/** Floor tile and wall segment length. Layouts are authored in these units. */
export const MODULE = 2.0;
/** Floor to ceiling. The ceiling panel sits on top of this. */
export const WALL_H = 3.0;
export const WALL_T = 0.16;
export const DOOR_W = 1.3;
export const DOOR_H = 2.35;

export const KIT_PARTS = [
  // shell
  'KitFloor',
  'KitFloorTile',
  'KitFloorScreed',
  'KitCeiling',
  'KitWall',
  'KitWallWindow',
  'KitWallDoor',
  'KitDoorLeaf',
  // furniture
  'KitCounter',
  'KitShelf',
  'KitDesk',
  'KitChair',
  'KitStool',
  'KitTable',
  'KitBed',
  'KitWardrobe',
  'KitLocker',
  'KitShower',
  'KitSign',
  'KitPlanter',
  'KitCrate',
  // hero props
  'KitFridge',
  'KitTill',
  'KitClinicBed',
  'KitCellBars',
  'KitToolBench',
  'KitCarLift',
  'KitCoffeeBar',
  'KitClothingRack',
  'KitFlightDesk',
] as const;

export type KitPart = (typeof KIT_PARTS)[number];

const PART_SET: ReadonlySet<string> = new Set(KIT_PARTS);

export function isKitPart(name: string): name is KitPart {
  return PART_SET.has(name);
}

/** Which parts a wall run may be made of. */
export const WALL_PARTS = ['KitWall', 'KitWallWindow', 'KitWallDoor', 'KitCellBars'] as const;
export type WallPart = (typeof WALL_PARTS)[number];

export const FLOOR_PARTS = ['KitFloor', 'KitFloorTile', 'KitFloorScreed'] as const;
export type FloorPart = (typeof FLOOR_PARTS)[number];

/**
 * An axis-aligned collision box in the part's own frame, before yaw.
 *
 * Half-extents plus an optional centre offset — the same shape `World` already
 * uses for building colliders, so `CollisionWorld` needs no new entry point.
 */
export interface KitBox {
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  readonly ox?: number;
  readonly oy?: number;
  readonly oz?: number;
}

/**
 * Collision for every part, in Three.js space.
 *
 * An empty list is deliberate, not missing: a sign is on a wall, a till is on
 * a counter, and a door leaf must not block the doorway it decorates. Those
 * four would each be a bug if they had a box.
 */
export const PART_COLLIDERS: Readonly<Record<KitPart, readonly KitBox[]>> = {
  // The floor slab hangs below the walking surface at y = 0.
  KitFloor: [{ hx: MODULE / 2, hy: 0.06, hz: MODULE / 2, oy: -0.06 }],
  KitFloorTile: [{ hx: MODULE / 2, hy: 0.06, hz: MODULE / 2, oy: -0.06 }],
  KitFloorScreed: [{ hx: MODULE / 2, hy: 0.06, hz: MODULE / 2, oy: -0.06 }],
  KitCeiling: [{ hx: MODULE / 2, hy: 0.05, hz: MODULE / 2, oy: WALL_H + 0.05 }],

  KitWall: [{ hx: MODULE / 2, hy: WALL_H / 2, hz: WALL_T / 2, oy: WALL_H / 2 }],
  // The pane is solid to the player; you cannot climb through a window.
  KitWallWindow: [{ hx: MODULE / 2, hy: WALL_H / 2, hz: WALL_T / 2, oy: WALL_H / 2 }],
  // Two piers and a lintel, so the doorway itself stays open.
  KitWallDoor: [
    {
      hx: (MODULE - DOOR_W) / 4,
      hy: WALL_H / 2,
      hz: WALL_T / 2,
      ox: -(DOOR_W + (MODULE - DOOR_W) / 2) / 2,
      oy: WALL_H / 2,
    },
    {
      hx: (MODULE - DOOR_W) / 4,
      hy: WALL_H / 2,
      hz: WALL_T / 2,
      ox: (DOOR_W + (MODULE - DOOR_W) / 2) / 2,
      oy: WALL_H / 2,
    },
    {
      hx: DOOR_W / 2,
      hy: (WALL_H - DOOR_H) / 2,
      hz: WALL_T / 2,
      oy: WALL_H - (WALL_H - DOOR_H) / 2,
    },
  ],
  KitDoorLeaf: [],

  KitCounter: [{ hx: 1.05, hy: 0.505, hz: 0.38, oy: 0.505 }],
  KitShelf: [{ hx: 0.8, hy: 0.95, hz: 0.23, oy: 0.95 }],
  KitDesk: [{ hx: 0.75, hy: 0.385, hz: 0.36, oy: 0.385 }],
  KitChair: [{ hx: 0.24, hy: 0.36, hz: 0.24, oy: 0.36 }],
  KitStool: [{ hx: 0.2, hy: 0.33, hz: 0.2, oy: 0.33 }],
  KitTable: [{ hx: 0.42, hy: 0.385, hz: 0.42, oy: 0.385 }],
  KitBed: [{ hx: 0.525, hy: 0.32, hz: 1.025, oy: 0.32 }],
  KitWardrobe: [{ hx: 0.55, hy: 1.0, hz: 0.31, oy: 1.0, oz: -0.02 }],
  KitLocker: [{ hx: 0.6, hy: 0.95, hz: 0.25, oy: 0.95 }],
  // Back and side panels only — the tray is walk-in, which is what makes the
  // shower a place you stand rather than a box you bump into.
  KitShower: [
    { hx: 0.46, hy: 1.0, hz: 0.025, oy: 1.0, oz: -0.435 },
    { hx: 0.025, hy: 1.0, hz: 0.46, ox: 0.435, oy: 1.0 },
  ],
  KitSign: [],
  KitPlanter: [{ hx: 0.31, hy: 0.2, hz: 0.31, oy: 0.2 }],
  KitCrate: [{ hx: 0.3, hy: 0.23, hz: 0.3, oy: 0.23 }],

  KitFridge: [{ hx: 0.8, hy: 0.95, hz: 0.36, oy: 0.95, oz: -0.03 }],
  KitTill: [],
  KitClinicBed: [{ hx: 0.4, hy: 0.42, hz: 0.98, oy: 0.42 }],
  KitCellBars: [{ hx: MODULE / 2, hy: WALL_H / 2, hz: 0.06, oy: WALL_H / 2 }],
  KitToolBench: [{ hx: 1.03, hy: 0.46, hz: 0.37, oy: 0.46, oz: -0.02 }],
  // The pad is drive-on; the two posts are not.
  KitCarLift: [
    { hx: 1.22, hy: 0.05, hz: 0.8, oy: 0.05 },
    { hx: 0.12, hy: 1.3, hz: 0.15, ox: -1.1, oy: 1.3, oz: -0.55 },
    { hx: 0.12, hy: 1.3, hz: 0.15, ox: 1.1, oy: 1.3, oz: -0.55 },
  ],
  KitCoffeeBar: [{ hx: 0.46, hy: 0.29, hz: 0.27, oy: 0.29 }],
  KitClothingRack: [{ hx: 0.8, hy: 0.81, hz: 0.3, oy: 0.81 }],
  KitFlightDesk: [{ hx: 0.95, hy: 0.4, hz: 0.41, oy: 0.4, oz: -0.02 }],
};

/** Which side of a cell an edge sits on. */
export type Side = 'n' | 's' | 'e' | 'w';

export const SIDES: readonly Side[] = ['n', 's', 'e', 'w'];

/** The cell on the far side of an edge. */
export const SIDE_STEP: Readonly<Record<Side, readonly [number, number]>> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

/** The opposite side, for matching an edge seen from its neighbour. */
export const OPPOSITE: Readonly<Record<Side, Side>> = { n: 's', s: 'n', e: 'w', w: 'e' };

/**
 * Where a wall segment on this edge sits, and which way it faces.
 *
 * Walls are authored running along X, so north and south take yaw 0 and east
 * and west take a quarter turn. `inward` is the unit vector from the edge
 * toward the cell's centre — what a spawn point and a facing are built from.
 */
export function edgeTransform(
  cx: number,
  cz: number,
  side: Side,
): { x: number; z: number; yaw: number; inward: readonly [number, number] } {
  const [sx, sz] = SIDE_STEP[side];
  return {
    x: cx * MODULE + (sx * MODULE) / 2,
    z: cz * MODULE + (sz * MODULE) / 2,
    yaw: sx === 0 ? 0 : Math.PI / 2,
    // `-0` rather than `0` would be harmless arithmetic and a wrong *facing*:
    // atan2(-0, -1) is -PI where atan2(0, -1) is +PI. Same direction, opposite
    // sign in every save file and every assertion.
    inward: [sx === 0 ? 0 : -sx, sz === 0 ? 0 : -sz],
  };
}

/** Centre of a cell, in room-local metres. */
export function cellCentre(cx: number, cz: number): { x: number; z: number } {
  return { x: cx * MODULE, z: cz * MODULE };
}

/** A collision box resolved into room-local space. */
export interface PlacedBox {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hx: number;
  readonly hy: number;
  readonly hz: number;
  /** Yaw the box itself carries, for an oriented collider. */
  readonly yaw: number;
}

/**
 * Place a part's boxes at (x, y, z) with a yaw.
 *
 * Three.js rotates about +Y as (x, z) -> (x·cos + z·sin, −x·sin + z·cos), so
 * the *offset* rotates with the part while the half-extents stay in the box's
 * own frame — the collider is oriented, not an AABB. One implementation,
 * shared by the builder and the validator, so the room the player collides
 * with and the room the tests check can never be two different rooms.
 */
export function placeBoxes(
  part: KitPart,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): PlacedBox[] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return PART_COLLIDERS[part].map((b) => {
    const ox = b.ox ?? 0;
    const oz = b.oz ?? 0;
    return {
      x: x + ox * cos + oz * sin,
      y: y + (b.oy ?? 0),
      z: z + (-ox * sin + oz * cos),
      hx: b.hx,
      hy: b.hy,
      hz: b.hz,
      yaw,
    };
  });
}

/** Knee height. A box whose top is below this is stepped over, not into. */
export const STEP_OVER = 0.25;
/** Shoulder height. A box whose bottom is above this is walked under. */
export const STAND_HEIGHT = 1.85;

/**
 * Would this box stop a person standing here?
 *
 * Plan overlap alone is not enough, and the doorway is the proof: the lintel
 * of `KitWallDoor` covers the whole opening in X and Z, so a purely 2D test
 * calls a doorway blocked. It also gets the car lift wrong in the other
 * direction — the pad is 10 cm high and meant to be driven onto.
 *
 * This is a *standing* test, not a collision test. Everything still collides;
 * this only decides whether a spot is somewhere a character can be put.
 */
export function blocksStanding(box: PlacedBox): boolean {
  return box.y + box.hy > STEP_OVER && box.y - box.hy < STAND_HEIGHT;
}

/**
 * Does a vertical circle at (px, pz) overlap this box in plan?
 *
 * Works in the box's own frame rather than growing an AABB, because a 0.92 m
 * shower panel yawed by a quarter turn has a very different footprint from its
 * bounding box, and the difference is exactly the width of a doorway.
 */
export function circleHitsBox(box: PlacedBox, px: number, pz: number, radius: number): boolean {
  const cos = Math.cos(-box.yaw);
  const sin = Math.sin(-box.yaw);
  const dx = px - box.x;
  const dz = pz - box.z;
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  const nx = Math.max(0, Math.abs(lx) - box.hx);
  const nz = Math.max(0, Math.abs(lz) - box.hz);
  return nx * nx + nz * nz < radius * radius;
}
