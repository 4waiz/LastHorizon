import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { VEHICLES, lodFor } from '../src/vehicles/VehicleDefinition';

/**
 * The generated GLB against the definitions that describe it.
 *
 * `build_vehicles.py` duplicates every dimension from `VehicleDefinition.ts`,
 * because Python cannot import TypeScript. Nothing keeps the two in step except
 * this file. A node renamed on one side and not the other produces a vehicle
 * that loads as an empty group and drives around invisibly — the physics is
 * fine, so nothing throws.
 *
 * Read straight out of the GLB's JSON chunk rather than through a loader: this
 * is about what was *exported*, and a loader would sanitise the names on the
 * way in. That sanitisation already cost Phase 4 fourteen of twenty bones.
 */

const GLB = 'public/assets/models/vehicles.glb';

interface GlbJson {
  nodes?: Array<{ name?: string; mesh?: number }>;
  meshes?: Array<{ name?: string; primitives: Array<{ indices: number; material?: number }> }>;
  materials?: Array<{ name?: string }>;
  accessors?: Array<{ count: number }>;
  images?: unknown[];
  textures?: unknown[];
}

function readGlb(): GlbJson {
  const buf = readFileSync(GLB);
  const jsonLength = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson;
}

const glb = existsSync(GLB) ? readGlb() : null;
const names = new Set((glb?.nodes ?? []).map((n) => n.name ?? ''));

/** Triangles in the mesh a node points at. */
function trianglesOf(node: string): number {
  const n = (glb?.nodes ?? []).find((x) => x.name === node);
  if (!n || n.mesh === undefined) return 0;
  const mesh = glb!.meshes![n.mesh];
  return mesh.primitives.reduce((sum, p) => sum + glb!.accessors![p.indices].count / 3, 0);
}

describe('the vehicle GLB exists', () => {
  it('was generated', () => {
    // Committed build output, per the repository's rule that scripts/blender is
    // the source of truth and the GLBs are artefacts of it.
    expect(glb, `${GLB} missing — run build_vehicles.py`).not.toBeNull();
  });
});

describe('every definition finds its model', () => {
  for (const def of VEHICLES) {
    it(`${def.id} has its base mesh, LODs and collision proxy`, () => {
      expect(names.has(def.model), `missing node ${def.model}`).toBe(true);
      expect(names.has(def.collisionProxy), `missing node ${def.collisionProxy}`).toBe(true);

      for (const lod of def.lods) {
        const node = def.model + lod.suffix;
        expect(names.has(node), `missing LOD node ${node}`).toBe(true);
      }
    });
  }

  it('resolves a far-away LOD to a node that is really there', () => {
    for (const def of VEHICLES) {
      const far = def.model + lodFor(def, 1000);
      expect(names.has(far), `${def.id} far LOD ${far} missing`).toBe(true);
    }
  });
});

describe('detail actually falls off', () => {
  for (const def of VEHICLES) {
    it(`${def.id} gets cheaper at every LOD step`, () => {
      const counts = def.lods.map((l) => trianglesOf(def.model + l.suffix));
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i], `${def.id} LOD ${i} is not cheaper`).toBeLessThan(counts[i - 1]);
      }
    });
  }

  it('keeps collision proxies to a box', () => {
    // A proxy with a wing mirror in it turns every kerb into something to
    // snag on, which is the same reason CollisionWorld uses proxies.
    for (const def of VEHICLES) {
      expect(trianglesOf(def.collisionProxy), `${def.id} proxy too detailed`)
        .toBeLessThanOrEqual(12);
    }
  });

  it('does not use the render mesh for collision', () => {
    for (const def of VEHICLES) {
      expect(trianglesOf(def.collisionProxy)).toBeLessThan(trianglesOf(def.model));
    }
  });
});

describe('per-vehicle budgets', () => {
  /** Generous, but a car that quietly becomes 5k triangles should fail here. */
  const MAX_TRIS = 900;

  for (const def of VEHICLES) {
    it(`${def.id} stays within ${MAX_TRIS} triangles`, () => {
      expect(trianglesOf(def.model)).toBeGreaterThan(50);
      expect(trianglesOf(def.model)).toBeLessThanOrEqual(MAX_TRIS);
    });
  }

  it('the whole fleet stays small', () => {
    const total = (glb?.meshes ?? []).reduce(
      (sum, m) => sum + m.primitives.reduce((s, p) => s + glb!.accessors![p.indices].count / 3, 0),
      0,
    );
    expect(total).toBeLessThan(6000);
  });
});

describe('materials are shared, not per-vehicle', () => {
  const materials = new Set((glb?.materials ?? []).map((m) => m.name ?? ''));

  it('paints every body from one material', () => {
    // Colour variants come from tinting this at runtime. A material per car
    // would fragment draw calls for nothing.
    expect(materials.has('vehicle_paint')).toBe(true);
  });

  it('ships no per-vehicle paint materials', () => {
    for (const def of VEHICLES) {
      expect(materials.has(`${def.id}_paint`)).toBe(false);
      expect(materials.has(def.model)).toBe(false);
    }
  });

  it('uses no textures at all', () => {
    // The whole kit is flat palette colours; a texture here would be the first
    // one in the project and would need a licence entry.
    expect(glb?.images ?? []).toHaveLength(0);
    expect(glb?.textures ?? []).toHaveLength(0);
  });

  it('keeps the material count low enough not to fragment batching', () => {
    expect(materials.size).toBeLessThanOrEqual(16);
  });

  it('gives the police car its beacon colours', () => {
    expect(materials.has('beacon_blue')).toBe(true);
    expect(materials.has('beacon_red')).toBe(true);
  });
});
