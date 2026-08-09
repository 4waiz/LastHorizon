import { describe, expect, it } from 'vitest';
import {
  DOOR_W,
  MODULE,
  PART_COLLIDERS,
  WALL_H,
  WALL_T,
  blocksStanding,
  circleHitsBox,
  isKitPart,
  KIT_PARTS,
  placeBoxes,
} from '../src/world/interiors/InteriorKit';
import {
  SERVICE_TYPES,
  SPAWN_CLEARANCE,
  canonicalEdge,
  entrySpawn,
  exitPoint,
  formatHour,
  isOpenAt,
  validateInterior,
  wallRuns,
  type InteriorDef,
} from '../src/world/interiors/InteriorDefinition';
import { INTERIORS, interiorDef } from '../src/world/interiors/interiorCatalog';

/**
 * The kit's grid, as authored in scripts/blender/build_interior_kit.py.
 *
 * Duplicated here on purpose. If somebody widens the Blender module without
 * touching InteriorKit.ts, every wall in the game develops a gap and no other
 * test notices — the layouts still validate, they are just built on a lie.
 */
const BLENDER_GRID = { MODULE: 2.0, WALL_H: 3.0, WALL_T: 0.16, DOOR_W: 1.3 };

describe('interior kit', () => {
  it('matches the grid the Blender script authors', () => {
    expect(MODULE).toBe(BLENDER_GRID.MODULE);
    expect(WALL_H).toBe(BLENDER_GRID.WALL_H);
    expect(WALL_T).toBe(BLENDER_GRID.WALL_T);
    expect(DOOR_W).toBe(BLENDER_GRID.DOOR_W);
  });

  it('gives every part a collider entry', () => {
    for (const part of KIT_PARTS) {
      expect(PART_COLLIDERS[part], `${part} has no collider entry`).toBeDefined();
    }
    expect(Object.keys(PART_COLLIDERS)).toHaveLength(KIT_PARTS.length);
  });

  it('leaves the four pass-through parts without collision', () => {
    // A door leaf that collides is a doorway you cannot walk through; a sign
    // or a till that collides is a counter you cannot reach over.
    for (const part of ['KitDoorLeaf', 'KitSign', 'KitTill'] as const) {
      expect(PART_COLLIDERS[part]).toHaveLength(0);
    }
  });

  it('keeps the doorway in KitWallDoor clear', () => {
    const boxes = placeBoxes('KitWallDoor', 0, 0, 0, 0);
    const blocked = (x: number): boolean =>
      boxes.some((b) => blocksStanding(b) && circleHitsBox(b, x, 0, 0.3));
    // You can stand in the opening -- the lintel is overhead, not in the way.
    expect(blocked(0)).toBe(false);
    // The piers are solid.
    expect(blocked(0.9)).toBe(true);
  });

  it('walks under a lintel and over a lift pad', () => {
    const lintel = placeBoxes('KitWallDoor', 0, 0, 0).find((b) => b.y > 2)!;
    expect(blocksStanding(lintel)).toBe(false);

    const [pad, post] = placeBoxes('KitCarLift', 0, 0, 0);
    expect(blocksStanding(pad)).toBe(false); // 10 cm, meant to be driven onto
    expect(blocksStanding(post)).toBe(true);

    // A floor slab hangs below the walking surface and must never block.
    expect(placeBoxes('KitFloor', 0, 0, 0).every((b) => !blocksStanding(b))).toBe(true);
    // A ceiling panel is above head height.
    expect(placeBoxes('KitCeiling', 0, 0, 0).every((b) => !blocksStanding(b))).toBe(true);
  });

  it('rotates offsets with the part, not just the extents', () => {
    // KitWardrobe carries oz = -0.02. A quarter turn must move that offset
    // onto X, or every wall-hugging prop drifts on rotation.
    const [b] = placeBoxes('KitWardrobe', 0, 0, 0, Math.PI / 2);
    expect(b.x).toBeCloseTo(-0.02, 6);
    expect(b.z).toBeCloseTo(0, 6);
  });

  it('recognises kit part names and rejects anything else', () => {
    expect(isKitPart('KitCounter')).toBe(true);
    expect(isKitPart('HouseLarge')).toBe(false);
  });
});

describe('interior catalogue', () => {
  it('covers all nine required service types exactly once', () => {
    const services = INTERIORS.map((d) => d.service).sort();
    expect(services).toEqual([...SERVICE_TYPES].sort());
  });

  it('validates every layout', () => {
    for (const def of INTERIORS) {
      const result = validateInterior(def);
      expect(result.errors, `${def.id}: ${result.errors.join('; ')}`).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('resolves by id and returns null for an unknown one', () => {
    expect(interiorDef('grocery')?.name).toBe('Village grocery');
    expect(interiorDef('nowhere')).toBeNull();
  });

  it('gives every interior exactly one door and a walled perimeter', () => {
    for (const def of INTERIORS) {
      const runs = wallRuns(def);
      const doors = runs.filter((r) => r.part === 'KitWallDoor');
      expect(doors, `${def.id}`).toHaveLength(1);

      // A rectangle of w x d cells has 2(w + d) perimeter edges. Every one of
      // them must be filled, or the room has a hole in it.
      const xs = def.cells.map((c) => c.x);
      const zs = def.cells.map((c) => c.z);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const d = Math.max(...zs) - Math.min(...zs) + 1;
      const bars = (def.bars ?? []).length;
      expect(runs.length - bars, `${def.id} perimeter`).toBe(2 * (w + d));
    }
  });

  it('never emits the same wall twice', () => {
    for (const def of INTERIORS) {
      const keys = wallRuns(def)
        .filter((r) => r.part !== 'KitCellBars')
        .map((r) => canonicalEdge({ x: r.cell.x, z: r.cell.z, side: r.side }));
      expect(new Set(keys).size, `${def.id}`).toBe(keys.length);
    }
  });

  it('produces the same wall list on every call', () => {
    // Draw-call measurements are only comparable if the scene graph is.
    for (const def of INTERIORS) {
      expect(JSON.stringify(wallRuns(def))).toBe(JSON.stringify(wallRuns(def)));
    }
  });

  it('spawns the player inside, clear of every prop', () => {
    for (const def of INTERIORS) {
      const spawn = entrySpawn(def);
      for (const p of def.props) {
        for (const box of placeBoxes(p.part, p.x, p.y ?? 0, p.z, p.yaw ?? 0)) {
          expect(
            circleHitsBox(box, spawn.x, spawn.z, SPAWN_CLEARANCE),
            `${def.id}: ${p.part} blocks the spawn`,
          ).toBe(false);
        }
      }
    }
  });

  it('puts the exit prompt between the spawn and the door', () => {
    for (const def of INTERIORS) {
      const spawn = entrySpawn(def);
      const exit = exitPoint(def);
      // Both derived from the same edge, so the exit is always the nearer of
      // the two to the threshold.
      expect(Math.hypot(exit.x - spawn.x, exit.z - spawn.z)).toBeCloseTo(0.55, 6);
    }
  });

  it('faces the player into the room', () => {
    // Every door in the catalogue is on a +Z edge, so entry always looks -Z.
    for (const def of INTERIORS) {
      expect(entrySpawn(def).facing, `${def.id}`).toBeCloseTo(Math.PI, 6);
    }
  });

  it('gives the two hero interiors the live portal and nobody else', () => {
    const live = INTERIORS.filter((d) => d.livePortal).map((d) => d.id);
    expect(live.sort()).toEqual(['apartment', 'home']);
  });

  it('gives every shop a work point and a service', () => {
    for (const id of ['grocery', 'police', 'clinic', 'garage', 'cafe', 'clothing', 'airstrip']) {
      const def = interiorDef(id)!;
      expect(def.workPoints.length, `${id} work points`).toBeGreaterThan(0);
      expect(def.points.some((p) => p.service !== undefined), `${id} service`).toBe(true);
    }
  });
});

describe('opening hours', () => {
  it('treats null as always open', () => {
    for (const h of [0, 3.5, 12, 23.9]) expect(isOpenAt(null, h)).toBe(true);
  });

  it('handles an ordinary daytime range', () => {
    const h = { open: 7, close: 21 };
    expect(isOpenAt(h, 6.9)).toBe(false);
    expect(isOpenAt(h, 7)).toBe(true);
    expect(isOpenAt(h, 20.9)).toBe(true);
    expect(isOpenAt(h, 21)).toBe(false);
  });

  it('wraps past midnight without a special case', () => {
    const h = { open: 21, close: 3 };
    expect(isOpenAt(h, 22)).toBe(true);
    expect(isOpenAt(h, 0)).toBe(true);
    expect(isOpenAt(h, 2.9)).toBe(true);
    expect(isOpenAt(h, 3)).toBe(false);
    expect(isOpenAt(h, 12)).toBe(false);
  });

  it('normalises hours outside 0..24', () => {
    const h = { open: 7, close: 21 };
    expect(isOpenAt(h, 31)).toBe(true); // 07:00 the next day
    expect(isOpenAt(h, -2)).toBe(false); // 22:00 the day before
  });

  it('formats an hour for a closed sign', () => {
    expect(formatHour(7)).toBe('07:00');
    expect(formatHour(21.5)).toBe('21:30');
    expect(formatHour(0)).toBe('00:00');
  });

  it('keeps the round-the-clock services open', () => {
    for (const id of ['home', 'apartment', 'clinic', 'police']) {
      expect(interiorDef(id)!.hours, id).toBeNull();
    }
  });
});

describe('layout validation', () => {
  const base = (): InteriorDef => ({
    id: 'test',
    name: 'Test',
    service: 'home',
    floor: 'KitFloor',
    cells: [
      { x: 0, z: 0 },
      { x: 0, z: 1 },
    ],
    door: { x: 0, z: 1, side: 's' },
    props: [],
    points: [],
    workPoints: [],
    audio: 'home',
    hours: null,
    livePortal: false,
    lights: [],
  });

  it('accepts a minimal room', () => {
    expect(validateInterior(base()).ok).toBe(true);
  });

  it('rejects a door on an internal edge', () => {
    const def = { ...base(), door: { x: 0, z: 0, side: 's' as const } };
    expect(validateInterior(def).errors.join()).toContain('not on the perimeter');
  });

  it('rejects a prop standing in the void', () => {
    const def = { ...base(), props: [{ part: 'KitChair' as const, x: 40, z: 0 }] };
    expect(validateInterior(def).errors.join()).toContain('off the floor');
  });

  it('rejects a prop parked on the entry spawn', () => {
    const spawn = entrySpawn(base());
    const def = { ...base(), props: [{ part: 'KitWardrobe' as const, x: spawn.x, z: spawn.z }] };
    expect(validateInterior(def).errors.join()).toContain('blocks the entry spawn');
  });

  it('rejects duplicate point ids', () => {
    const pt = { id: 'dup', kind: 'chair' as const, x: 0, y: 1, z: 0, radius: 1, prompt: 'x' };
    const def = { ...base(), points: [pt, { ...pt }] };
    expect(validateInterior(def).errors.join()).toContain('duplicate point id');
  });

  it('rejects a window that is also the door', () => {
    const def = { ...base(), windows: [{ x: 0, z: 1, side: 's' as const }] };
    expect(validateInterior(def).errors.join()).toContain('is also the door');
  });

  it('matches an edge seen from either of the cells it separates', () => {
    // (0,0) south and (0,1) north are the same wall.
    expect(canonicalEdge({ x: 0, z: 0, side: 's' })).toBe(canonicalEdge({ x: 0, z: 1, side: 'n' }));
    expect(canonicalEdge({ x: 0, z: 0, side: 'e' })).toBe(canonicalEdge({ x: 1, z: 0, side: 'w' }));
  });
});
