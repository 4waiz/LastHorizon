import * as THREE from 'three';
import { toonFromImported } from '../../graphics/ToonMaterial';
import {
  MODULE,
  cellCentre,
  placeBoxes,
  type KitPart,
  type PlacedBox,
} from './InteriorKit';
import {
  entrySpawn,
  exitPoint,
  wallRuns,
  type InteriorDef,
  type InteriorPoint,
} from './InteriorDefinition';

/**
 * Assemble one interior from the kit.
 *
 * The def says which cells and which props; this puts kit clones in a group,
 * lifts everything into the room's own pocket of space, and hands back the
 * colliders and the resolved world-space points.
 *
 * Why a pocket rather than inside the building shell: the terrain grid is
 * ~2 m per cell, far too coarse to hold a house-sized floor flat, so a room
 * built on the heightfield ends up partly buried on a slope. That reasoning
 * is inherited from the single-room Phase 4 implementation and has not
 * changed — what has changed is that there are nine rooms now, so each gets
 * its own origin and only the open one is ever built.
 */

/** Where interiors live: well clear of the 360 m terrain, and of each other. */
export const INTERIOR_CELL_Y = 600;
/** Metres between one room's origin and the next. */
export const INTERIOR_CELL_PITCH = 200;

/**
 * Deterministic origin per interior.
 *
 * Index-based rather than hashed so the same build always puts the same room
 * in the same place — a screenshot or a draw-call measurement taken indoors
 * is only comparable if the camera is somewhere reproducible.
 */
export function interiorOrigin(index: number): THREE.Vector3 {
  return new THREE.Vector3(index * INTERIOR_CELL_PITCH, INTERIOR_CELL_Y, 0);
}

/** A point resolved into world space, ready to register as an interactable. */
export interface BuiltPoint extends InteriorPoint {
  readonly world: THREE.Vector3;
}

export interface BuiltInterior {
  readonly def: InteriorDef;
  readonly group: THREE.Group;
  readonly origin: THREE.Vector3;
  readonly colliders: THREE.Mesh[];
  readonly lights: THREE.PointLight[];
  readonly spawn: THREE.Vector3;
  readonly spawnFacing: number;
  readonly exit: THREE.Vector3;
  readonly points: readonly BuiltPoint[];
  /** Work points in world space, for the population to stand at. */
  readonly workPoints: readonly { id: string; role: string; world: THREE.Vector3; facing: number }[];
  readonly stats: { parts: number; triangles: number; colliderBoxes: number };
  dispose(): void;
}

export interface BuildOptions {
  /** Kit parts by node name, from `AssetManager.loadInteriorKit()`. */
  readonly kit: ReadonlyMap<string, THREE.Object3D>;
  readonly origin: THREE.Vector3;
  /** Live render target for the hero interiors' window panes. */
  readonly portalMaterial?: THREE.Material;
  /** Decoration item ids the player has placed, keyed by slot id. */
  readonly decor?: ReadonlyMap<string, KitPart>;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const INVISIBLE = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Clone a kit part and convert its materials.
 *
 * `toonFromImported` caches on (colour, kind, flags), so thirty clones of a
 * shelf share one material and one program. Nothing here passes `allowWind` —
 * a bookshelf whose colour happens to be called `leaf_mid` must not sway.
 */
function instantiate(
  kit: ReadonlyMap<string, THREE.Object3D>,
  part: KitPart,
  portalMaterial?: THREE.Material,
): THREE.Object3D | null {
  const proto = kit.get(part);
  if (!proto) return null;
  const obj = proto.clone(true);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const convert = (src: THREE.Material): THREE.Material => {
      if (portalMaterial && src.name?.includes('portal_glass')) return portalMaterial;
      return toonFromImported(src, `Interior:${part}`);
    };
    const m = mesh.material;
    mesh.material = Array.isArray(m) ? m.map(convert) : convert(m as THREE.Material);
  });
  return obj;
}

function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const idx = mesh.geometry.getIndex();
    n += idx ? idx.count / 3 : mesh.geometry.getAttribute('position').count / 3;
  });
  return n;
}

/** One invisible box mesh, in world space, for the collision overlay. */
function colliderMesh(box: PlacedBox, origin: THREE.Vector3): THREE.Mesh {
  const m = new THREE.Mesh(UNIT_BOX, INVISIBLE);
  m.position.set(origin.x + box.x, origin.y + box.y, origin.z + box.z);
  m.rotation.y = box.yaw;
  m.scale.set(box.hx * 2, box.hy * 2, box.hz * 2);
  m.updateMatrixWorld(true);
  return m;
}

export function buildInterior(def: InteriorDef, opts: BuildOptions): BuiltInterior {
  const { kit, origin } = opts;
  const group = new THREE.Group();
  group.name = `Interior:${def.id}`;
  group.position.copy(origin);

  const colliders: THREE.Mesh[] = [];
  const lights: THREE.PointLight[] = [];
  let parts = 0;

  const add = (part: KitPart, x: number, y: number, z: number, yaw: number): void => {
    // A hero interior's windows show the live world; everywhere else the pane
    // is an ordinary toon material, which is the whole point of the portal
    // being opt-in. See `livePortal` in InteriorDefinition.
    const usePortal = def.livePortal && part === 'KitWallWindow' ? opts.portalMaterial : undefined;
    const obj = instantiate(kit, part, usePortal);
    if (obj) {
      obj.position.set(x, y, z);
      obj.rotation.y = yaw;
      obj.updateMatrixWorld(true);
      group.add(obj);
      parts++;
    }
    // Collision is registered whether or not the mesh loaded. A kit that
    // failed to fetch should leave you in an empty room, not one you can
    // walk out of the side of.
    for (const box of placeBoxes(part, x, y, z, yaw)) {
      colliders.push(colliderMesh(box, origin));
    }
  };

  for (const c of def.cells) {
    const p = cellCentre(c.x, c.z);
    add(def.floor, p.x, 0, p.z, 0);
    add('KitCeiling', p.x, 0, p.z, 0);
  }

  for (const run of wallRuns(def)) {
    add(run.part, run.x, 0, run.z, run.yaw);
  }

  for (const p of def.props) {
    add(p.part, p.x, p.y ?? 0, p.z, p.yaw ?? 0);
  }

  // Bought decorations, if any. The slot supplies the place, the save supplies
  // the part — so decorating adds no geometry the kit does not already have.
  for (const slot of def.decorSlots ?? []) {
    const part = opts.decor?.get(slot.id);
    if (part) add(part, slot.x, 0, slot.z, slot.yaw ?? 0);
  }

  for (const l of def.lights) {
    const light = new THREE.PointLight(l.colour, l.power, MODULE * 5.5, 1.8);
    light.position.set(l.x, l.y, l.z);
    group.add(light);
    lights.push(light);
  }

  const spawn = entrySpawn(def);
  const exit = exitPoint(def);
  const lift = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(origin.x + x, origin.y + y, origin.z + z);

  const built: BuiltInterior = {
    def,
    group,
    origin: origin.clone(),
    colliders,
    lights,
    spawn: lift(spawn.x, 0.02, spawn.z),
    spawnFacing: spawn.facing,
    exit: lift(exit.x, exit.y, exit.z),
    points: def.points.map((p) => ({ ...p, world: lift(p.x, p.y, p.z) })),
    workPoints: def.workPoints.map((w) => ({
      id: w.id,
      role: w.role,
      world: lift(w.x, 0, w.z),
      facing: w.facing,
    })),
    stats: {
      parts,
      triangles: countTriangles(group),
      colliderBoxes: colliders.length,
    },
    dispose(): void {
      group.removeFromParent();
      // Geometry and materials are shared with the kit prototypes and the
      // toon cache respectively, so disposing them here would break the next
      // room to ask for the same shelf. What this owns is the graph and the
      // collider meshes, and the collider meshes share one unit box.
      group.traverse((o) => {
        const light = o as THREE.PointLight;
        if (light.isPointLight) light.dispose();
      });
      group.clear();
      colliders.length = 0;
      lights.length = 0;
    },
  };

  return built;
}
