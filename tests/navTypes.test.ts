import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DOOR_APPROACH,
  NAV_AGENT,
  NAV_CELL_HEIGHT,
  NAV_CELL_SIZE,
  NAV_CONFIG,
  navInputFromGeometry,
  offMeshLinksForZone,
  preferredCrossing,
  type OffMeshLink,
} from '../src/nav/NavTypes';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';
import { DEFAULT_MOTOR } from '../src/physics/CharacterMotor';

const VILLAGE = WORLD_MANIFEST.zones.find((z) => z.id === 'village_coast')!;
const flatGround = () => 0;

/** An indexed quad in the XZ plane, centred on (cx, cz). */
function quad(cx: number, cz: number, half: number, y = 0): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [cx - half, y, cz - half, cx + half, y, cz - half, cx + half, y, cz + half, cx - half, y, cz + half],
      3,
    ),
  );
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

describe('the generator config', () => {
  it('agrees with the character motor about slope', () => {
    // If the navmesh thinks a bank is walkable and the capsule does not, NPCs
    // path up it and stop dead halfway.
    const motorSlope = Math.acos(DEFAULT_MOTOR.maxSlopeDot) * (180 / Math.PI);
    expect(NAV_CONFIG.walkableSlopeAngle).toBeCloseTo(motorSlope, 0);
  });

  it('agrees with the character motor about the agent radius', () => {
    expect(NAV_AGENT.radius).toBeCloseTo(DEFAULT_MOTOR.radius, 6);
  });

  it('expresses height, climb and radius in voxels, not metres', () => {
    // The Phase 2 blocker in one assertion. `walkableHeight` in metres would be
    // 1.94, which as a voxel count at ch 0.2 is 39 cm of headroom.
    expect(NAV_CONFIG.walkableHeight * NAV_CELL_HEIGHT).toBeCloseTo(2.0, 1);
    expect(NAV_CONFIG.walkableClimb * NAV_CELL_HEIGHT).toBeCloseTo(0.4, 1);
    expect(NAV_CONFIG.walkableRadius * NAV_CELL_SIZE).toBeCloseTo(0.3, 6);
  });

  it('keeps a standard doorway open after erosion', () => {
    // Erosion applies from both sides. Two voxels would take 1.2 m out of a
    // 1.2 m door and close it completely.
    const erosion = NAV_CONFIG.walkableRadius * NAV_CELL_SIZE * 2;
    expect(erosion).toBeLessThan(1.2);
  });

  it('steps a kerb', () => {
    // CityBuilder's KERB_H is 0.14 m.
    expect(NAV_CONFIG.walkableClimb * NAV_CELL_HEIGHT).toBeGreaterThan(0.14);
  });

  it('is tiled', () => {
    expect(NAV_CONFIG.tileSize).toBeGreaterThan(0);
  });
});

describe('extracting geometry', () => {
  const bounds = { minX: -10, minZ: -10, maxX: 10, maxZ: 10 };

  it('keeps triangles inside the bounds', () => {
    const input = navInputFromGeometry(quad(0, 0, 5), bounds);
    expect(input.indices.length / 3).toBe(2);
    expect(input.positions.length / 3).toBe(4);
  });

  it('drops triangles wholly outside them', () => {
    // The case this exists for: the interior cell is parked at y = 600 in its
    // own corner of world space, and without the filter it becomes a floating
    // navmesh island 600 m above the village.
    const g = mergeQuads([quad(0, 0, 3), quad(500, 500, 3, 600)]);
    const input = navInputFromGeometry(g, bounds);
    expect(input.indices.length / 3).toBe(2);
  });

  it('keeps a triangle that straddles the boundary', () => {
    // Clipping would leave a ragged edge exactly where an agent walks.
    const input = navInputFromGeometry(quad(9, 0, 3), bounds);
    expect(input.indices.length / 3).toBe(2);
  });

  it('drops degenerate triangles', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1], 3),
    );
    g.setIndex([0, 1, 2, 3, 4, 5]);
    const input = navInputFromGeometry(g, bounds);
    // The first triangle is three collinear points; only the second survives.
    expect(input.indices.length / 3).toBe(1);
  });

  it('handles a non-indexed geometry', () => {
    const g = quad(0, 0, 4);
    const input = navInputFromGeometry(g.toNonIndexed(), bounds);
    expect(input.indices.length / 3).toBe(2);
  });

  it('shares vertices rather than duplicating them', () => {
    // Two triangles over four corners; a naive copy would emit six vertices.
    const input = navInputFromGeometry(quad(0, 0, 5), bounds);
    expect(input.positions.length / 3).toBe(4);
  });

  it('reports a vertical range with margin around the geometry', () => {
    const input = navInputFromGeometry(quad(0, 0, 5, 3), bounds);
    expect(input.minY).toBeLessThan(3);
    expect(input.maxY).toBeGreaterThan(3);
  });

  it('survives geometry with nothing in bounds', () => {
    const input = navInputFromGeometry(quad(900, 900, 2), bounds);
    expect(input.indices.length).toBe(0);
    expect(Number.isFinite(input.minY)).toBe(true);
    expect(Number.isFinite(input.maxY)).toBe(true);
  });

  it('drops a roof, and keeps the ground under it', () => {
    // The bug this exists for: a flat roof is a walkable slope with unlimited
    // headroom, so Recast puts navmesh on it. The first run of Phase 6 had
    // residents standing on houses.
    const g = mergeQuads([quad(0, 0, 5, 0), quad(0, 0, 3, 5.6)]);
    const input = navInputFromGeometry(g, bounds, { groundAt: () => 0 });
    expect(input.indices.length / 3).toBe(2);
    expect(input.maxY).toBeLessThan(5.6 + 40);
  });

  it('keeps a porch step, which is low enough to be a floor', () => {
    const g = mergeQuads([quad(0, 0, 5, 0), quad(3, 3, 1, 0.4)]);
    const input = navInputFromGeometry(g, bounds, { groundAt: () => 0 });
    expect(input.indices.length / 3).toBe(4);
  });

  it('keeps a ramp that climbs past the threshold at one end', () => {
    // All three corners must be too high, not the centroid: dropping a partly
    // high triangle cuts the navmesh in half at the bottom of a slope.
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 4, 0, 0, 4, 6, 4], 3),
    );
    g.setIndex([0, 1, 2]);
    expect(navInputFromGeometry(g, bounds, { groundAt: () => 0 }).indices.length / 3).toBe(1);
  });

  it('keeps everything when no ground function is supplied', () => {
    const g = mergeQuads([quad(0, 0, 5, 0), quad(0, 0, 3, 5.6)]);
    expect(navInputFromGeometry(g, bounds).indices.length / 3).toBe(4);
  });

  it('drops a triangle with a non-finite vertex', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, NaN, 0, 1], 3),
    );
    g.setIndex([0, 1, 2]);
    expect(navInputFromGeometry(g, bounds).indices.length).toBe(0);
  });
});

describe('off-mesh links', () => {
  it('gives every interior door a link', () => {
    const links = offMeshLinksForZone(VILLAGE, flatGround);
    const doors = links.filter((l) => l.kind === 'door');
    expect(doors).toHaveLength(VILLAGE.interiors.length);
  });

  it('gives every crossing a link', () => {
    const links = offMeshLinksForZone(VILLAGE, flatGround);
    expect(links.filter((l) => l.kind === 'crossing')).toHaveLength(VILLAGE.crossings.length);
  });

  it('puts the street end of a door link outside the building', () => {
    const links = offMeshLinksForZone(VILLAGE, flatGround);
    const door = links.find((l) => l.kind === 'door')!;
    const span = Math.hypot(door.end.x - door.start.x, door.end.z - door.start.z);
    expect(span).toBeCloseTo(DOOR_APPROACH, 5);
  });

  it('steps a door out toward the middle of the zone, not off the edge', () => {
    const links = offMeshLinksForZone(VILLAGE, flatGround);
    const door = links.find((l) => l.kind === 'door')!;
    const centreX = (VILLAGE.bounds.minX + VILLAGE.bounds.maxX) / 2;
    const centreZ = (VILLAGE.bounds.minZ + VILLAGE.bounds.maxZ) / 2;
    const before = Math.hypot(door.end.x - centreX, door.end.z - centreZ);
    const after = Math.hypot(door.start.x - centreX, door.start.z - centreZ);
    expect(after).toBeLessThan(before);
  });

  it('makes every link traversable in both directions', () => {
    for (const l of offMeshLinksForZone(VILLAGE, flatGround)) {
      expect(l.bidirectional).toBe(true);
      expect(l.radius).toBeGreaterThan(0);
    }
  });

  it('samples ground height rather than assuming zero', () => {
    const links = offMeshLinksForZone(VILLAGE, () => 12.5);
    for (const l of links) {
      expect(l.start.y).toBe(12.5);
      expect(l.end.y).toBe(12.5);
    }
  });

  it('produces nothing for a zone with no doors or crossings', () => {
    const airstrip = WORLD_MANIFEST.zones.find((z) => z.id === 'hill_airstrip')!;
    expect(offMeshLinksForZone(airstrip, flatGround)).toEqual([]);
  });
});

describe('preferring a crossing', () => {
  const crossing: OffMeshLink = {
    id: 'crossing:test',
    kind: 'crossing',
    start: { x: -6, y: 0, z: 0 },
    end: { x: 6, y: 0, z: 0 },
    radius: 1.1,
    bidirectional: true,
  };

  it('routes via a crossing when it is barely a detour', () => {
    const found = preferredCrossing({ x: -6, y: 0, z: 4 }, { x: 6, y: 0, z: 4 }, [crossing]);
    expect(found).toBe(crossing);
  });

  it('does not route via one that is miles out of the way', () => {
    const far: OffMeshLink = {
      ...crossing,
      start: { x: -6, y: 0, z: 300 },
      end: { x: 6, y: 0, z: 300 },
    };
    expect(preferredCrossing({ x: -6, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, [far])).toBeNull();
  });

  it('ignores door links', () => {
    const door: OffMeshLink = { ...crossing, id: 'door:x', kind: 'door' };
    expect(preferredCrossing({ x: -6, y: 0, z: 1 }, { x: 6, y: 0, z: 1 }, [door])).toBeNull();
  });

  it('returns null when there are no crossings at all', () => {
    expect(preferredCrossing({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, [])).toBeNull();
  });

  it('picks the nearer of two crossings', () => {
    const near = { ...crossing, id: 'near' };
    const further = {
      ...crossing,
      id: 'further',
      start: { x: -6, y: 0, z: 20 },
      end: { x: 6, y: 0, z: 20 },
    };
    const found = preferredCrossing({ x: -6, y: 0, z: 1 }, { x: 6, y: 0, z: 1 }, [further, near]);
    expect(found?.id).toBe('near');
  });
});

function mergeQuads(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const p of parts) {
    const pos = p.getAttribute('position');
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    const idx = p.getIndex()!;
    for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
    base += pos.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}
