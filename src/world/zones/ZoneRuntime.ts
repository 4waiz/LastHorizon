import type * as THREE from 'three';
import type { CollisionWorld } from '../../physics/CollisionWorld';
import type { QualityPreset } from '../../core/Settings';
import type { Interactable, WorldStats } from '../World';

/**
 * What `Game` needs from whatever zone is currently active.
 *
 * `Game` was written around `World` as a singleton — 25 references across 15
 * members. That is fine with one hand-authored zone and impossible with more:
 * a city district has no `Terrain`, no vegetation and no keepsakes, but it
 * still has to answer "how high is the ground here", "what do I collide with"
 * and "where does the player start".
 *
 * This interface is that contract. `World` implements it as-is; a city
 * runtime implements it differently. `Game` then talks to the contract rather
 * than to the village specifically, which is what lets a second zone exist.
 *
 * Members that are genuinely village-only — collectibles, the shared interior
 * cell — are deliberately **not** here. They stay on `World` and are reached
 * through a narrowed type, so a district is not forced to fake a keepsake
 * counter it does not have.
 */
export interface ZoneRuntime {
  /** Scene root for everything the zone owns. */
  readonly group: THREE.Group;

  /** Static collision for the character motor and camera probe. */
  readonly collision: CollisionWorld;

  /** Where the player starts, and which way they face. */
  readonly spawn: THREE.Vector3;
  readonly spawnFacing: number;

  /** Ground height at a world position. The village reads its heightfield; a
   *  district can answer from its slab layout. */
  heightAt(x: number, z: number): number;

  /** 0..1, drives footstep timbre. */
  surfaceHardness(x: number, z: number): number;

  /** False once the player has left the playable area. */
  inBounds(x: number, z: number): boolean;

  /** Doors, seats and anything else the interact prompt can offer. */
  readonly interactables: readonly Interactable[];

  /** Roads and buildings for the radar. */
  readonly mapData: {
    roads: Array<Array<{ x: number; z: number }>>;
    buildings: Array<{ x: number; z: number; r: number }>;
  };

  /** Debug-overlay counters. */
  readonly stats: WorldStats;

  update(
    dt: number,
    elapsed: number,
    player: THREE.Vector3,
    cameraPos: THREE.Vector3,
    lampFactor: number,
  ): void;

  applyQuality(preset: QualityPreset): void;

  dispose(): void;
}
