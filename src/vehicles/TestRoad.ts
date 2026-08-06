import * as THREE from 'three';
import { makeToon } from '../graphics/ToonMaterial';

/**
 * A closed proving ground, behind `?testroad=1`.
 *
 * The village is a nice place to drive and a poor place to *measure* driving:
 * its slopes are gentle and incidental, its kerbs are wherever a road happened
 * to bend, and there is nowhere to test a jump without aiming at somebody's
 * house. Tuning against it means tuning against whatever the terrain happened
 * to do at that spot, which is how the acceleration figures ended up being
 * taken on a hill.
 *
 * So: known gradients, right-angle junctions, square kerbs, a barrier to stop
 * against, marked parking bays and a ramp. Every element is a plain box, and
 * the whole thing is one merged geometry the collision world can swallow.
 *
 * Dev-only. It is built from a feature flag that defaults off, and it is not
 * referenced from the release path at all.
 */

export interface TestRoadPiece {
  readonly name: string;
  /** Full extents, metres. */
  readonly size: { x: number; y: number; z: number };
  readonly position: { x: number; y: number; z: number };
  /** Rotation about X, radians. Used for the slopes and the ramp. */
  readonly pitch?: number;
  /** Rotation about Y, radians. */
  readonly yaw?: number;
  readonly colour: number;
}

const TARMAC = 0x6f6f6c;
const KERB = 0xd8d2c2;
const PAINT = 0xe8e3d2;
const BARRIER = 0xc79a4e;

/**
 * The layout.
 *
 * Origin is the start line. The main straight runs along +Z so a vehicle
 * spawned facing 0 is pointing down it, matching every other spawn in the
 * project and saving a rotation in every test that uses it.
 */
export function testRoadPieces(): TestRoadPiece[] {
  const pieces: TestRoadPiece[] = [];
  const push = (p: TestRoadPiece) => pieces.push(p);

  // ---- main straight: 120 m, flat, for acceleration and braking runs -------
  push({ name: 'straight', size: { x: 10, y: 0.4, z: 120 }, position: { x: 0, y: -0.2, z: 60 }, colour: TARMAC });
  for (const side of [-1, 1]) {
    push({
      name: `straight_kerb_${side}`,
      size: { x: 0.4, y: 0.28, z: 120 },
      position: { x: side * 5.2, y: -0.06, z: 60 },
      colour: KERB,
    });
  }
  // Distance markers every 20 m, so a run can be read off a screenshot.
  for (let z = 20; z <= 100; z += 20) {
    push({ name: `marker_${z}`, size: { x: 9, y: 0.02, z: 0.4 }, position: { x: 0, y: 0.01, z }, colour: PAINT });
  }

  // ---- graded slopes, branching left at 30 m ------------------------------
  // Three known gradients. Holding position on a slope is the thing that is
  // impossible to check on terrain that is "about 8 degrees somewhere".
  const grades = [
    { name: 'slope_5deg', degrees: 5, x: -26 },
    { name: 'slope_12deg', degrees: 12, x: -44 },
    { name: 'slope_20deg', degrees: 20, x: -62 },
  ];
  for (const g of grades) {
    const pitch = (g.degrees * Math.PI) / 180;
    const length = 26;
    push({
      name: g.name,
      size: { x: 8, y: 0.4, z: length },
      position: { x: g.x, y: (Math.sin(pitch) * length) / 2 - 0.2, z: 30 },
      pitch: -pitch,
      colour: TARMAC,
    });
    // A flat shelf at the top, so a vehicle can stop and be asked to hold.
    push({
      name: `${g.name}_shelf`,
      size: { x: 8, y: 0.4, z: 8 },
      position: { x: g.x, y: Math.sin(pitch) * length - 0.2, z: 30 + length / 2 + 4 },
      colour: TARMAC,
    });
  }
  // The connector that reaches them.
  push({ name: 'slope_link', size: { x: 60, y: 0.4, z: 8 }, position: { x: -32, y: -0.2, z: 30 }, colour: TARMAC });

  // ---- crossroads at 60 m -------------------------------------------------
  push({ name: 'junction', size: { x: 40, y: 0.4, z: 10 }, position: { x: 0, y: -0.2, z: 60 }, colour: TARMAC });
  for (const side of [-1, 1]) {
    push({
      name: `junction_kerb_${side}`,
      size: { x: 40, y: 0.28, z: 0.4 },
      position: { x: 0, y: -0.06, z: 60 + side * 5.2 },
      colour: KERB,
    });
  }

  // ---- parking bays, right of the straight at 80 m ------------------------
  push({ name: 'car_park', size: { x: 18, y: 0.4, z: 22 }, position: { x: 14, y: -0.2, z: 80 }, colour: TARMAC });
  for (let i = 0; i < 5; i++) {
    push({
      name: `bay_${i}`,
      size: { x: 0.12, y: 0.02, z: 5 },
      position: { x: 6.5 + i * 2.6, y: 0.01, z: 80 },
      colour: PAINT,
    });
  }

  // ---- barrier at the far end --------------------------------------------
  // Something solid to stop against at speed. This is what the tunnelling
  // check aims at: a wall of known thickness rather than a house that happens
  // to be there.
  push({ name: 'barrier', size: { x: 12, y: 1.2, z: 0.5 }, position: { x: 0, y: 0.6, z: 121 }, colour: BARRIER });

  // ---- jump, on a spur to the right at 40 m ------------------------------
  push({ name: 'jump_apron', size: { x: 8, y: 0.4, z: 24 }, position: { x: 16, y: -0.2, z: 40 }, colour: TARMAC });
  push({
    name: 'jump_ramp',
    size: { x: 8, y: 0.4, z: 10 },
    position: { x: 16, y: 0.7, z: 52 },
    pitch: -(14 * Math.PI) / 180,
    colour: TARMAC,
  });
  push({ name: 'jump_landing', size: { x: 12, y: 0.4, z: 20 }, position: { x: 16, y: -0.2, z: 72 }, colour: TARMAC });

  return pieces;
}

/**
 * Build the road.
 *
 * Returns the group to add to the scene and the meshes the collision world
 * should swallow — the same list, because every piece here is already a
 * simple box and there is nothing to gain from a separate proxy.
 */
export function buildTestRoad(origin: THREE.Vector3): {
  group: THREE.Group;
  colliders: THREE.Mesh[];
} {
  const group = new THREE.Group();
  group.name = 'TestRoad';
  const colliders: THREE.Mesh[] = [];

  for (const piece of testRoadPieces()) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(piece.size.x, piece.size.y, piece.size.z),
      makeToon(piece.colour, { id: `testroad_${piece.colour.toString(16)}` }),
    );
    mesh.name = `testroad:${piece.name}`;
    mesh.position.set(
      origin.x + piece.position.x,
      origin.y + piece.position.y,
      origin.z + piece.position.z,
    );
    if (piece.pitch) mesh.rotation.x = piece.pitch;
    if (piece.yaw) mesh.rotation.y = piece.yaw;
    mesh.receiveShadow = true;
    mesh.castShadow = piece.size.y > 0.5;
    mesh.updateMatrixWorld(true);

    group.add(mesh);
    colliders.push(mesh);
  }

  return { group, colliders };
}

/** Named places on the road, for tests and for the debug spawn. */
export const TEST_ROAD_MARKS = {
  start: { x: 0, z: 4, facing: 0 },
  slope5: { x: -26, z: 22, facing: 0 },
  slope12: { x: -44, z: 22, facing: 0 },
  slope20: { x: -62, z: 22, facing: 0 },
  junction: { x: 0, z: 60, facing: 0 },
  parking: { x: 14, z: 76, facing: Math.PI / 2 },
  jump: { x: 16, z: 34, facing: 0 },
  barrierRun: { x: 0, z: 40, facing: 0 },
} as const;

export type TestRoadMark = keyof typeof TEST_ROAD_MARKS;
