import * as THREE from 'three';
import { CollisionWorld } from '../../physics/CollisionWorld';
import type { QualityPreset } from '../../core/Settings';
import type { Interactable, WorldStats } from '../World';
import type { ZoneManifest } from './Manifest';
import type { ZoneRuntime } from './ZoneRuntime';
import {
  cityChunkBuildings,
  KERB_H,
  MAIN_ROAD_X,
  ROAD_HALF,
  SIDEWALK_W,
  SIDE_STREET_Z,
} from './CityBuilder';

/**
 * A city district, answering the same contract the village does.
 *
 * The village derives ground height from a heightfield and surface from a
 * rasterised road field. A district has neither: it is authored from flat
 * slabs on fixed axes, so both answers come from the street layout directly —
 * which is why `CityBuilder` exports its constants rather than keeping them
 * private. Two copies of the road half-width would drift, and the player would
 * hear grass underfoot while standing on tarmac.
 *
 * Collision is rebuilt as chunks stream, since the set of solid geometry
 * changes with residency.
 */
export class CityRuntime implements ZoneRuntime {
  readonly group: THREE.Group;
  readonly collision = new CollisionWorld();
  readonly spawn = new THREE.Vector3();
  spawnFacing = 0;

  /** Solid meshes contributed by resident chunks, keyed by chunk id. */
  private readonly colliders = new Map<string, THREE.Mesh[]>();
  private colliderTris = 0;
  private buildingCount = 0;

  constructor(private readonly manifest: ZoneManifest, group?: THREE.Group) {
    this.group = group ?? new THREE.Group();
    this.group.name = `zone_${manifest.id}`;

    const def =
      manifest.spawns.find((s) => s.id === manifest.defaultSpawnId) ?? manifest.spawns[0];
    if (def) {
      this.spawn.set(def.x, 0, def.z);
      this.spawnFacing = def.facing;
    }
  }

  // --------------------------------------------------------------- surfaces

  /** True if this point lies on a carriageway. */
  private onRoad(x: number, z: number): boolean {
    return (
      Math.abs(x - MAIN_ROAD_X) <= ROAD_HALF || Math.abs(z - SIDE_STREET_Z) <= ROAD_HALF
    );
  }

  /** True if this point lies on a raised sidewalk flanking a carriageway. */
  private onSidewalk(x: number, z: number): boolean {
    if (this.onRoad(x, z)) return false;
    const dx = Math.abs(x - MAIN_ROAD_X);
    const dz = Math.abs(z - SIDE_STREET_Z);
    return (
      (dx > ROAD_HALF && dx <= ROAD_HALF + SIDEWALK_W) ||
      (dz > ROAD_HALF && dz <= ROAD_HALF + SIDEWALK_W)
    );
  }

  /**
   * Ground height. The district is flat: the chunk plate and carriageway sit
   * at 0, sidewalks a kerb above. Building interiors are not walkable yet, so
   * there is no upper storey to resolve.
   */
  heightAt(x: number, z: number): number {
    return this.onSidewalk(x, z) ? KERB_H : 0;
  }

  /** Tarmac is hard, paving slightly less so, the rest is dressing. */
  surfaceHardness(x: number, z: number): number {
    if (this.onRoad(x, z)) return 1;
    if (this.onSidewalk(x, z)) return 0.85;
    return 0.6;
  }

  /**
   * An arrow property, not a method — deliberately, and matching `World`.
   * `PlayerController` holds this as a bare function reference, so a method
   * would lose `this` and throw on the first frame after arrival. The
   * `ZoneRuntime` interface cannot express that difference, which is why it is
   * called out here.
   */
  inBounds = (x: number, z: number): boolean => {
    const b = this.manifest.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  };

  // ------------------------------------------------------------- collision

  /**
   * Register a chunk's solid geometry and rebuild. Called as chunks stream in;
   * `releaseChunkColliders` is the matching half, so an unloaded chunk stops
   * contributing collision as well as render objects.
   */
  addChunkColliders(chunkId: string, meshes: THREE.Mesh[]): void {
    this.colliders.set(chunkId, meshes);
    this.rebuildCollision();
  }

  releaseChunkColliders(chunkId: string): void {
    if (this.colliders.delete(chunkId)) this.rebuildCollision();
  }

  private rebuildCollision(): void {
    const all = [...this.colliders.values()].flat();
    this.collision.build(all);
    this.colliderTris = all.reduce((n, m) => {
      const idx = m.geometry.getIndex();
      const pos = m.geometry.getAttribute('position');
      return n + (idx ? idx.count : pos ? pos.count : 0) / 3;
    }, 0);
    this.buildingCount = this.colliders.size;
  }

  // ------------------------------------------------------------------ rest

  /** No doors wired yet; interior links exist in the manifest for Phase 7. */
  get interactables(): readonly Interactable[] {
    return [];
  }

  /**
   * Radar data for the district.
   *
   * Roads come from the carriageway axes the geometry is actually built on,
   * spanning the full zone, not from the lane graph — that is a six-node
   * routing skeleton for future traffic, and drawing it gave a map with two
   * short lines on it.
   *
   * Buildings come from every chunk in the manifest rather than only the
   * resident ones. A map that reveals itself as you walk is a fog-of-war
   * feature nobody asked for; the district layout is fixed and knowable.
   */
  get mapData(): {
    roads: Array<Array<{ x: number; z: number }>>;
    buildings: Array<{ x: number; z: number; r: number }>;
  } {
    const b = this.manifest.bounds;
    const roads = [
      // Main road, running north-south along x = MAIN_ROAD_X.
      [
        { x: MAIN_ROAD_X, z: b.minZ },
        { x: MAIN_ROAD_X, z: b.maxZ },
      ],
      // Side street, running east-west along z = SIDE_STREET_Z.
      [
        { x: b.minX, z: SIDE_STREET_Z },
        { x: b.maxX, z: SIDE_STREET_Z },
      ],
    ];

    const buildings = this.manifest.chunks.flatMap((chunk) =>
      cityChunkBuildings(chunk).map((p) => ({ x: p.x, z: p.z, r: p.r })),
    );

    return { roads, buildings };
  }

  get stats(): WorldStats {
    return {
      vegetation: 0,
      grass: 0,
      colliderTris: Math.round(this.colliderTris),
      buildings: this.buildingCount,
    };
  }

  /** Nothing in the prototype animates yet — no vegetation, birds or pickups. */
  update(): void {
    /* intentionally empty */
  }

  /** Quality affects streamed chunk content, which the streamer owns. */
  applyQuality(_preset: QualityPreset): void {
    /* intentionally empty */
  }

  dispose(): void {
    this.colliders.clear();
    // The counters are derived, so clearing the map alone leaves stats
    // reporting geometry that no longer exists.
    this.colliderTris = 0;
    this.buildingCount = 0;
    this.collision.dispose();
    this.group.removeFromParent();
  }
}
