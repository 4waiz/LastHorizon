import * as THREE from 'three';
import { CollisionWorld } from '../../physics/CollisionWorld';
import type { QualityPreset } from '../../core/Settings';
import type { Interactable, WorldStats } from '../World';
import type { ZoneManifest } from './Manifest';
import type { ZoneRuntime } from './ZoneRuntime';
import {
  APRON,
  BUILDINGS,
  OFFICE_DOOR,
  onPaved,
  RUNWAY,
  RUNWAY_Z,
  TAXI_MID,
  TAXI_WEST,
} from './AirstripBuilder';

/**
 * The airstrip, answering the same contract the village and the districts do.
 *
 * Flat, like a district and unlike the village: there is no heightfield up
 * here, so ground height is zero everywhere and surface hardness comes
 * straight from the paved rectangles `AirstripBuilder` lays down. One source,
 * so a player never hears grass while standing on a runway.
 *
 * Collision is set once, on build, rather than rebuilt as chunks arrive — an
 * authored zone has no chunks.
 */
export class AirstripRuntime implements ZoneRuntime {
  readonly group: THREE.Group;
  readonly collision = new CollisionWorld();
  readonly spawn = new THREE.Vector3();
  spawnFacing = 0;

  private readonly doors: Interactable[] = [];
  private colliderTris = 0;

  constructor(private readonly manifest: ZoneManifest, group?: THREE.Group) {
    this.group = group ?? new THREE.Group();
    this.group.name = `zone_${manifest.id}`;

    const def =
      manifest.spawns.find((s) => s.id === manifest.defaultSpawnId) ?? manifest.spawns[0];
    if (def) {
      this.spawn.set(def.x, 0, def.z);
      this.spawnFacing = def.facing;
    }

    /*
     * One door, and it is named rather than derived.
     *
     * `InteriorLink` carries an interior id and a prompt but no service, and
     * the interior-id-to-service map lives in `interiorCatalog`, which is a
     * lazy chunk this runtime has no other reason to pull in. With exactly one
     * door on the field, importing 23 kB to look up a constant would be the
     * expensive way to be clever. If the airstrip ever grows a second door,
     * move the service onto `InteriorLink` rather than adding a second literal.
     */
    const link = manifest.interiors[0];
    if (link) {
      this.doors.push({
        position: new THREE.Vector3(OFFICE_DOOR.x, 1.0, OFFICE_DOOR.z),
        radius: 2.4,
        kind: 'enter',
        prompt: link.prompt,
        doorId: `${manifest.id}:airstrip:0`,
        service: 'airstrip',
      });
    }
  }

  // --------------------------------------------------------------- surfaces

  /** The plateau is flat. The strip was graded; that is the whole point of it. */
  heightAt(): number {
    return 0;
  }

  /** Tarmac is hard, the scrub either side is not. */
  surfaceHardness(x: number, z: number): number {
    return onPaved(x, z) ? 1 : 0.55;
  }

  /**
   * An arrow property, not a method — deliberately, and matching `World` and
   * `CityRuntime`. `PlayerController` holds this as a bare function reference,
   * so a method would lose `this` and throw on the first frame after arrival.
   */
  inBounds = (x: number, z: number): boolean => {
    const b = this.manifest.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  };

  // ------------------------------------------------------------- collision

  /**
   * Hand the built geometry to collision. Called once, from the zone builder.
   *
   * The ground plate is deliberately included. A field that renders and does
   * not collide is a field the player falls through.
   */
  setColliders(meshes: THREE.Mesh[]): void {
    this.collision.build(meshes);
    this.colliderTris = meshes.reduce((n, m) => {
      const idx = m.geometry.getIndex();
      const pos = m.geometry.getAttribute('position');
      return n + (idx ? idx.count : pos ? pos.count : 0) / 3;
    }, 0);
  }

  // ------------------------------------------------------------------ rest

  get interactables(): readonly Interactable[] {
    return this.doors;
  }

  /**
   * Radar data.
   *
   * The runway, both taxiways and the apron spine are drawn as "roads" — they
   * are the lines a player navigates by up here, and the minimap has no
   * separate notion of a taxiway. Buildings come from the same table the
   * geometry does.
   */
  get mapData(): {
    roads: Array<Array<{ x: number; z: number }>>;
    buildings: Array<{ x: number; z: number; r: number }>;
  } {
    const apronZ = (APRON.z0 + APRON.z1) / 2;
    const taxiWestX = (TAXI_WEST.x0 + TAXI_WEST.x1) / 2;
    const taxiMidX = (TAXI_MID.x0 + TAXI_MID.x1) / 2;

    return {
      roads: [
        [
          { x: RUNWAY.x0, z: RUNWAY_Z },
          { x: RUNWAY.x1, z: RUNWAY_Z },
        ],
        [
          { x: APRON.x0, z: apronZ },
          { x: APRON.x1, z: apronZ },
        ],
        [
          { x: taxiWestX, z: RUNWAY_Z },
          { x: taxiWestX, z: apronZ },
        ],
        [
          { x: taxiMidX, z: RUNWAY_Z },
          { x: taxiMidX, z: apronZ },
        ],
      ],
      buildings: BUILDINGS.map((b) => ({ x: b.x, z: b.z, r: b.r })),
    };
  }

  get stats(): WorldStats {
    return {
      vegetation: 0,
      grass: 0,
      colliderTris: Math.round(this.colliderTris),
      buildings: BUILDINGS.length,
    };
  }

  /** Nothing up here animates. The windsock is geometry, not a simulation. */
  update(): void {
    /* intentionally empty */
  }

  /** The field is 90-odd boxes at every preset; there is nothing to scale. */
  applyQuality(_preset: QualityPreset): void {
    /* intentionally empty */
  }

  dispose(): void {
    this.colliderTris = 0;
    this.collision.dispose();
    this.group.removeFromParent();
  }
}
