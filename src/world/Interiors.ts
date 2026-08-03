import * as THREE from 'three';
import { toonFromImported } from '../graphics/ToonMaterial';

/**
 * The interior cell.
 *
 * Every front door in the neighbourhood leads to the same room, and that room
 * lives far above the terrain rather than inside a building shell. That is a
 * deliberate choice, not a shortcut: the terrain grid is ~2 m per cell, which
 * is far too coarse to reliably hold a house-sized platform flat, so any floor
 * built on the heightfield ends up partly buried on a slope. Putting the room
 * in its own pocket of space removes the heightfield from the problem
 * entirely, and lets one well-detailed room serve every house.
 */

/** Where the cell sits, well clear of the 360 m terrain. */
export const INTERIOR_ORIGIN = new THREE.Vector3(0, 600, 0);

const ROOM_W = 8.4;
const ROOM_D = 7.0;
const ROOM_H = 3.05;
const ROOM_T = 0.16;
const DOOR_W = 1.25;
const DOOR_H = 2.30;

const HW = ROOM_W / 2;
const HD = ROOM_D / 2;
const T = ROOM_T / 2;

/**
 * Collision boxes in room-local space.
 *
 * The Blender model faces -Y, which the exporter maps to +Z, so Blender +Y
 * reads as local -Z here. The front wall is split around the doorway.
 */
function roomBoxes(): Array<[number, number, number, number, number, number]> {
  const dl = -DOOR_W / 2;
  const dr = DOOR_W / 2;
  const wy = ROOM_H / 2;
  return [
    // x, y, z, hx, hy, hz
    [0, -0.10, 0, HW, 0.10, HD], // floor
    [0, ROOM_H + 0.08, 0, HW, 0.08, HD], // ceiling
    [0, wy, -(HD - T), HW, wy, T], // back wall
    [-(HW - T), wy, 0, T, wy, HD], // left wall
    [HW - T, wy, 0, T, wy, HD], // right wall
    [(-HW + dl) / 2, wy, HD - T, (dl + HW) / 2, wy, T], // front, left of door
    [(dr + HW) / 2, wy, HD - T, (HW - dr) / 2, wy, T], // front, right of door
    [0, (ROOM_H + DOOR_H) / 2, HD - T, DOOR_W / 2, (ROOM_H - DOOR_H) / 2, T], // lintel
    // furniture
    [2.89, 0.35, -1.89, 1.06, 0.35, 1.26], // bed
    [-1.60, 0.42, -2.72, 1.04, 0.42, 0.42], // desk
    [-1.60, 0.30, -1.64, 0.30, 0.30, 0.30], // chair
    [-3.60, 1.08, 2.04, 0.42, 1.08, 0.82], // wardrobe
    [3.80, 0.92, 2.09, 0.22, 0.92, 0.86], // bookshelf
    [2.89, 0.28, 0.55, 0.68, 0.28, 0.32], // trunk
    [-3.65, 0.36, -2.75, 0.36, 0.36, 0.36], // plant pot
  ];
}

/** Spawn just inside the doorway, facing into the room. */
export const ROOM_SPAWN = new THREE.Vector3(0, 0.02, 1.55);
export const ROOM_SPAWN_FACING = Math.PI;

/** Where the exit prompt sits, and where the bed is. */
export const ROOM_EXIT = new THREE.Vector3(0, 1.0, HD - 0.55);
export const ROOM_BED = new THREE.Vector3(2.89, 0.72, -1.89);
/** Standing spot beside the bed, used when waking up. */
export const ROOM_BEDSIDE = new THREE.Vector3(1.45, 0.02, -1.60);

export class Interiors {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];

  /** Room-local positions lifted into world space. */
  readonly spawn = new THREE.Vector3();
  readonly exit = new THREE.Vector3();
  readonly bed = new THREE.Vector3();
  readonly bedside = new THREE.Vector3();

  constructor(prototype: THREE.Object3D | undefined) {
    this.group.name = 'Interior';
    this.group.position.copy(INTERIOR_ORIGIN);

    if (prototype) {
      const room = prototype.clone(true);
      room.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const m = mesh.material;
        mesh.material = Array.isArray(m)
          ? m.map((mm) => toonFromImported(mm, 'RoomInterior'))
          : toonFromImported(m as THREE.Material, 'RoomInterior');
      });
      this.group.add(room);
    }

    const invisible = new THREE.MeshBasicMaterial({ visible: false });
    const unit = new THREE.BoxGeometry(1, 1, 1);
    for (const [x, y, z, hx, hy, hz] of roomBoxes()) {
      const m = new THREE.Mesh(unit, invisible);
      m.position.set(INTERIOR_ORIGIN.x + x, INTERIOR_ORIGIN.y + y, INTERIOR_ORIGIN.z + z);
      m.scale.set(hx * 2, hy * 2, hz * 2);
      m.updateMatrixWorld(true);
      this.colliders.push(m);
    }

    // Warm practicals: the pendant and the two bedside/desk lamps.
    for (const [x, y, z, colour, power] of [
      [0.6, ROOM_H - 0.95, 0.4, 0xffe0ad, 22],
      [1.34, 0.95, -2.84, 0xffd39a, 9],
      [-2.22, 1.25, -2.66, 0xffcf94, 8],
    ] as Array<[number, number, number, number, number]>) {
      const l = new THREE.PointLight(colour, power, 11, 1.8);
      l.position.set(x, y, z);
      this.group.add(l);
      this.lights.push(l);
    }
    // A cool fill from the windows so the far corners aren't black.
    const win = new THREE.PointLight(0xd7e6f2, 7, 12, 1.6);
    win.position.set(-1.4, 2.0, -3.0);
    this.group.add(win);
    this.lights.push(win);

    this.spawn.copy(ROOM_SPAWN).add(INTERIOR_ORIGIN);
    this.exit.copy(ROOM_EXIT).add(INTERIOR_ORIGIN);
    this.bed.copy(ROOM_BED).add(INTERIOR_ORIGIN);
    this.bedside.copy(ROOM_BEDSIDE).add(INTERIOR_ORIGIN);

    this.setVisible(false);
  }

  /** The cell only exists while the player is in it. */
  setVisible(on: boolean): void {
    this.group.visible = on;
    for (const l of this.lights) l.visible = on;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.colliders.length = 0;
    this.lights = [];
  }
}
