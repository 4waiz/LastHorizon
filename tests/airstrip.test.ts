import { describe, it, expect } from 'vitest';
import {
  APRON,
  BUILDINGS,
  OFFICE_DOOR,
  onPaved,
  PAVED,
  RUNWAY,
  RUNWAY_HEADING,
  RUNWAY_Z,
  TAXI_MID,
  TAXI_WEST,
} from '../src/world/zones/AirstripBuilder';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';
import { validateWorldManifest } from '../src/world/zones/Manifest';
import { CHECKPOINTS, GROUND_BOUNDS, FLIGHT_CORRIDOR } from '../src/flight/WorldBounds';
import {
  FlightModel,
  NEUTRAL_INPUT,
  PLANE_TUNING,
  type FlightHost,
  type FlightInput,
} from '../src/flight/FlightModel';

/**
 * The field, checked against the three files that have to agree about it.
 *
 * `AirstripBuilder` lays the tarmac, `worldManifest` decides where a player
 * arrives, and `WorldBounds` decides where a recovered aeroplane is put back.
 * Nothing enforces that those three agree except this file — and a recovery
 * checkpoint sitting in the scrub is a recovery that needs another recovery.
 *
 * The takeoff run at the bottom is the real acceptance test. A runway you
 * cannot get off is scenery.
 */

const zone = WORLD_MANIFEST.zones.find((z) => z.id === 'hill_airstrip')!;

const FLAT: FlightHost = { groundAt: () => 0 };
const input = (over: Partial<FlightInput> = {}): FlightInput => ({ ...NEUTRAL_INPUT, ...over });

describe('the field is open', () => {
  it('is playable, authored, and passes world validation', () => {
    expect(zone.playable).toBe(true);
    expect(zone.kind).toBe('authored');
    expect(validateWorldManifest(WORLD_MANIFEST)).toEqual([]);
  });

  it('reaches the village and back', () => {
    expect(zone.neighbours).toContain('village_coast');
    const village = WORLD_MANIFEST.zones.find((z) => z.id === 'village_coast')!;
    expect(village.neighbours).toContain('hill_airstrip');
  });

  it('has an office door, and the manifest link sits on it', () => {
    const link = zone.interiors[0];
    expect(link?.interiorId).toBe('airstrip');
    // Within a stride of the door the geometry actually builds. A link a
    // few metres off is a prompt that never appears.
    expect(Math.hypot(link.x - OFFICE_DOOR.x, link.z - OFFICE_DOOR.z)).toBeLessThan(1.5);
  });
});

describe('every authored point lands on tarmac', () => {
  it('puts all three spawns on paved ground', () => {
    for (const s of zone.spawns) {
      expect(onPaved(s.x, s.z), `spawn ${s.id} is not on tarmac`).toBe(true);
    }
  });

  /**
   * The one that would actually have shipped broken. `nearestCheckpoint` is
   * the fallback for a stranded aeroplane, and it returns coordinates from
   * `WorldBounds` that nothing else validates.
   */
  it('puts every airstrip recovery checkpoint on paved ground', () => {
    const here = CHECKPOINTS.filter((c) => c.id.startsWith('airstrip_'));
    expect(here.length).toBeGreaterThan(0);
    for (const c of here) {
      expect(onPaved(c.x, c.z), `checkpoint ${c.id} is not on tarmac`).toBe(true);
      expect(c.accepts).toContain('air');
    }
  });

  it('keeps every paved rectangle inside the zone', () => {
    for (const r of PAVED) {
      expect(r.x0).toBeGreaterThanOrEqual(zone.bounds.minX);
      expect(r.x1).toBeLessThanOrEqual(zone.bounds.maxX);
      expect(r.z0).toBeGreaterThanOrEqual(zone.bounds.minZ);
      expect(r.z1).toBeLessThanOrEqual(zone.bounds.maxZ);
    }
  });

  it('keeps the whole field inside the flight corridor and the ground bounds', () => {
    for (const cfg of [FLIGHT_CORRIDOR, GROUND_BOUNDS]) {
      expect(RUNWAY.x0).toBeGreaterThan(cfg.minX);
      expect(RUNWAY.x1).toBeLessThan(cfg.maxX);
      expect(RUNWAY.z0).toBeGreaterThan(cfg.minZ);
      expect(RUNWAY.z1).toBeLessThan(cfg.maxZ);
    }
  });
});

describe('the layout reads as an airstrip', () => {
  it('connects the apron to the runway at both ends of the taxi links', () => {
    // A link that does not touch both is a taxiway to nowhere.
    for (const t of [TAXI_WEST, TAXI_MID]) {
      expect(t.z0).toBeLessThanOrEqual(RUNWAY.z1);
      expect(t.z1).toBeGreaterThanOrEqual(APRON.z0);
    }
  });

  it('keeps buildings clear of the strip', () => {
    for (const b of BUILDINGS) {
      const halfD = b.d / 2;
      expect(b.z - halfD, `${b.id} overhangs the runway`).toBeGreaterThan(RUNWAY.z1);
    }
  });

  it('parks nothing on the runway itself', () => {
    for (const b of BUILDINGS) {
      expect(onPaved(b.x, b.z) && b.z <= RUNWAY.z1).toBe(false);
    }
  });

  it('runs the strip east, which is what the spawns face', () => {
    expect(RUNWAY_HEADING).toBeCloseTo(Math.PI / 2, 5);
    const hold = zone.spawns.find((s) => s.id === 'airstrip_hold')!;
    expect(hold.facing).toBeCloseTo(RUNWAY_HEADING, 5);
  });

  it('is not paved where it is not paved', () => {
    // The scrub north of the fence, and the ground well east of the strip.
    expect(onPaved(140, 60)).toBe(false);
    expect(onPaved(360, RUNWAY_Z)).toBe(false);
    expect(onPaved(176, 40)).toBe(false);
  });
});

describe('the runway is long enough to fly off', () => {
  /**
   * Full power from the western threshold, rotate once there is enough air
   * over the tail, and see where the wheels leave the ground.
   *
   * The margin matters more than the fact: an aeroplane that lifts off with
   * four metres to spare is one tuning change away from a runway overrun, and
   * a runway overrun at the airstrip is a crash into the fence.
   */
  function takeoffRoll(): { liftoffX: number; used: number } {
    const m = new FlightModel(FLAT);
    m.placeAt(RUNWAY.x0 + 6, RUNWAY_Z, RUNWAY_HEADING);

    const rotate = PLANE_TUNING.stallSpeed * 1.12;
    for (let s = 0; s < 60 * 60; s++) {
      const pulling = m.airspeed >= rotate;
      m.advance(1 / 60, input({ throttle: 1, pitch: pulling ? 1 : 0 }));
      if (!m.onGround) break;
    }

    const x = m.state().position.x;
    return { liftoffX: x, used: x - RUNWAY.x0 };
  }

  it('gets the wheels up with runway to spare', () => {
    const { liftoffX, used } = takeoffRoll();
    expect(used, 'never left the ground').toBeGreaterThan(0);
    expect(liftoffX).toBeLessThan(RUNWAY.x1);
    // A quarter of the strip left at rotation. Anything tighter and the
    // margin is a coincidence rather than a design.
    const remaining = RUNWAY.x1 - liftoffX;
    expect(remaining / (RUNWAY.x1 - RUNWAY.x0)).toBeGreaterThan(0.25);
  });

  it('is still on tarmac at the moment it rotates', () => {
    const { liftoffX } = takeoffRoll();
    expect(onPaved(liftoffX, RUNWAY_Z)).toBe(true);
  });

  /**
   * Is there a route over tarmac from A to B?
   *
   * A flood fill on a 1 m grid rather than a straight line between the two.
   * The first version of this test sampled the diagonal from the apron to the
   * hold and failed at the grass between the two taxi links — correctly
   * reporting that the diagonal is not paved, and incorrectly implying the
   * field was broken. An aeroplane taxis the L, not the hypotenuse.
   */
  function pavedRouteExists(
    from: { x: number; z: number },
    to: { x: number; z: number },
  ): boolean {
    const key = (x: number, z: number) => `${x},${z}`;
    const start = { x: Math.round(from.x), z: Math.round(from.z) };
    const goal = { x: Math.round(to.x), z: Math.round(to.z) };
    if (!onPaved(start.x, start.z) || !onPaved(goal.x, goal.z)) return false;

    const seen = new Set([key(start.x, start.z)]);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift()!;
      if (at.x === goal.x && at.z === goal.z) return true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = at.x + dx;
        const nz = at.z + dz;
        const k = key(nx, nz);
        if (seen.has(k) || !onPaved(nx, nz)) continue;
        seen.add(k);
        queue.push({ x: nx, z: nz });
      }
    }
    return false;
  }

  it('can taxi from the apron to the hold without leaving tarmac', () => {
    const from = CHECKPOINTS.find((c) => c.id === 'airstrip_apron')!;
    const to = CHECKPOINTS.find((c) => c.id === 'airstrip_hold')!;
    expect(pavedRouteExists(from, to)).toBe(true);
  });

  it('can taxi from the arrival spawn onto the runway', () => {
    const gate = zone.spawns.find((s) => s.id === 'airstrip_gate')!;
    expect(pavedRouteExists(gate, { x: RUNWAY.x1 - 10, z: RUNWAY_Z })).toBe(true);
  });

  it('does not pave a route to somewhere off the field', () => {
    // The fill has to be able to fail, or the two tests above prove nothing.
    const gate = zone.spawns.find((s) => s.id === 'airstrip_gate')!;
    expect(pavedRouteExists(gate, { x: 300, z: 90 })).toBe(false);
  });
});
