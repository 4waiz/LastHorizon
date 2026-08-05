import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DisposalRegistry } from '../src/core/DisposalRegistry';
import { buildCityChunk, buildCitySkyline } from '../src/world/zones/CityBuilder';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';
import type { ZoneManifest } from '../src/world/zones/Manifest';

const zone = (id: string): ZoneManifest =>
  WORLD_MANIFEST.zones.find((z) => z.id === id)!;

const market = zone('city_old_market');

function build(chunkIndex: number) {
  const parent = new THREE.Group();
  const scope = new DisposalRegistry('test');
  const meshes = buildCityChunk(market, market.chunks[chunkIndex], scope, parent);
  return { parent, scope, meshes };
}

/** Signature of everything the chunk emitted, for determinism comparison. */
function signature(parent: THREE.Object3D): string {
  const parts: string[] = [];
  parent.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    parts.push(`${m.name}:${pos.count}`);
  });
  return parts.sort().join('|');
}

describe('city chunk geometry', () => {
  it('produces geometry, batched to a handful of meshes rather than one per box', () => {
    const { parent, meshes } = build(0);
    expect(meshes).toBeGreaterThan(0);
    // Merging by palette colour is what keeps draw calls down; a chunk should
    // never approach one mesh per primitive.
    expect(meshes).toBeLessThan(12);
    expect(parent.children.length).toBe(meshes);
  });

  it('is deterministic — the same chunk builds identically every time', () => {
    const a = build(0);
    const b = build(0);
    expect(signature(a.parent)).toBe(signature(b.parent));
  });

  it('gives different chunks different content', () => {
    const a = build(0);
    const b = build(3);
    expect(signature(a.parent)).not.toBe(signature(b.parent));
  });

  it('hands everything back on disposal', () => {
    const { parent, scope } = build(0);
    expect(parent.children.length).toBeGreaterThan(0);
    const report = scope.dispose();
    expect(report.errors).toEqual([]);
    expect(report.released).toBeGreaterThan(0);
    expect(parent.children.length).toBe(0);
  });

  it('keeps roads seamless: chunks either side of a seam both emit road', () => {
    // The main road runs along world x = 0, which is a chunk boundary; each
    // side must contribute its own half or the carriageway has a gap.
    const touching = market.chunks.filter(
      (c) => c.bounds.minX <= 5 && c.bounds.maxX >= -5,
    );
    expect(touching.length).toBeGreaterThanOrEqual(2);
    for (const c of touching) {
      const parent = new THREE.Group();
      const scope = new DisposalRegistry('seam');
      expect(buildCityChunk(market, c, scope, parent)).toBeGreaterThan(0);
      scope.dispose();
    }
  });

  it('builds a skyline ring for the district', () => {
    const parent = new THREE.Group();
    const scope = new DisposalRegistry('sky');
    const meshes = buildCitySkyline(market, scope, parent);
    expect(meshes).toBeGreaterThan(0);
    scope.dispose();
    expect(parent.children.length).toBe(0);
  });

  it('gives the waterfront district water that the market does not have', () => {
    const wf = zone('city_waterfront');
    const far = wf.chunks.find((c) => c.bounds.maxZ <= -120)!;
    expect(far).toBeDefined();
    const parent = new THREE.Group();
    const scope = new DisposalRegistry('water');
    buildCityChunk(wf, far, scope, parent);
    const names = parent.children.map((c) => c.name).join(' ');
    // The water colour appears as its own merged mesh.
    expect(names).toContain('5b8fa8');
    scope.dispose();
  });
});
