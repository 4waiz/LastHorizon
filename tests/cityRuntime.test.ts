import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CityRuntime } from '../src/world/zones/CityRuntime';
import { KERB_H, ROAD_HALF } from '../src/world/zones/CityBuilder';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';

const market = WORLD_MANIFEST.zones.find((z) => z.id === 'city_old_market')!;
const make = () => new CityRuntime(market);

function solidBox(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial());
}

describe('CityRuntime', () => {
  it('takes its spawn from the manifest default', () => {
    const r = make();
    const def = market.spawns.find((s) => s.id === market.defaultSpawnId)!;
    expect(r.spawn.x).toBe(def.x);
    expect(r.spawn.z).toBe(def.z);
    expect(r.spawnFacing).toBe(def.facing);
  });

  it('puts the carriageway at zero and the sidewalk a kerb above it', () => {
    const r = make();
    expect(r.heightAt(0, 20)).toBe(0);                     // on the main road
    expect(r.heightAt(ROAD_HALF + 1, 20)).toBe(KERB_H);    // on its sidewalk
    expect(r.heightAt(60, 60)).toBe(0);                    // open block
  });

  it('reports tarmac as the hardest surface', () => {
    const r = make();
    const road = r.surfaceHardness(0, 20);
    const walk = r.surfaceHardness(ROAD_HALF + 1, 20);
    const block = r.surfaceHardness(60, 60);
    expect(road).toBeGreaterThan(walk);
    expect(walk).toBeGreaterThan(block);
  });

  it('treats both carriageways as road, not just the main one', () => {
    const r = make();
    expect(r.surfaceHardness(40, 0)).toBe(1); // the side street
  });

  it('knows its own bounds', () => {
    const r = make();
    expect(r.inBounds(0, 0)).toBe(true);
    expect(r.inBounds(99999, 0)).toBe(false);
  });

  it('derives radar roads from the lane graph', () => {
    const r = make();
    const { roads, buildings } = r.mapData;
    expect(roads.length).toBeGreaterThan(0);
    expect(roads[0]).toHaveLength(2);
    expect(buildings).toEqual([]);
  });

  it('starts with nothing to collide with', () => {
    const r = make();
    expect(r.stats.colliderTris).toBe(0);
    expect(r.stats.buildings).toBe(0);
    // A district has no vegetation to report, and must not invent any.
    expect(r.stats.vegetation).toBe(0);
    expect(r.stats.grass).toBe(0);
  });

  it('gains collision as chunks stream in and loses it as they leave', () => {
    const r = make();
    r.addChunkColliders('a', [solidBox()]);
    const withOne = r.stats.colliderTris;
    expect(withOne).toBeGreaterThan(0);
    expect(r.stats.buildings).toBe(1);

    r.addChunkColliders('b', [solidBox()]);
    expect(r.stats.colliderTris).toBeGreaterThan(withOne);

    // An unloaded chunk must stop contributing collision, not just rendering.
    r.releaseChunkColliders('b');
    expect(r.stats.colliderTris).toBe(withOne);
    r.releaseChunkColliders('a');
    expect(r.stats.colliderTris).toBe(0);
  });

  it('ignores a release for a chunk it never held', () => {
    const r = make();
    expect(() => r.releaseChunkColliders('never-loaded')).not.toThrow();
    expect(r.stats.colliderTris).toBe(0);
  });

  it('disposes without leaving colliders behind', () => {
    const r = make();
    r.addChunkColliders('a', [solidBox()]);
    r.dispose();
    expect(r.stats.buildings).toBe(0);
  });
});
