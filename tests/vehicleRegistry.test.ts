import { describe, it, expect, beforeEach } from 'vitest';
import { BICYCLE, HATCHBACK, POLICE, VAN, vehicleDef } from '../src/vehicles/VehicleDefinition';
import {
  VehicleRegistry,
  type RulesLookup,
  type StoredTransform,
} from '../src/vehicles/VehicleRegistry';

/**
 * The rules the registry would be given at runtime.
 *
 * It deliberately does not import the catalogue — that would drag 11.6 kB of
 * vehicle definitions into the startup bundle for the sake of saves, which
 * have to work whether or not the player ever drives. Tests are not bundled,
 * so they can build the same lookup from the real definitions.
 */
const RULES: RulesLookup = (kind) => {
  const d = vehicleDef(kind as never);
  if (!d) return null;
  return {
    fuelCapacity: d.fuel?.capacity ?? null,
    consumptionPerKm: d.fuel?.consumptionPerKm ?? 0,
    scratchSpeed: d.damage.scratchSpeed,
    dentSpeed: d.damage.dentSpeed,
    repairCost: d.damage.repairCost,
    impoundable: d.ownership.impoundable,
  };
};

const T = (x = 0, z = 0, facing = 0): StoredTransform => ({ x, y: 1, z, facing });

let reg: VehicleRegistry;

/** Register one of each kind that matters, in the village. */
function seed() {
  reg.setRules(RULES);
  reg.register({ id: 'bike1', kind: 'bicycle', zone: 'village_coast', transform: T(1, 1), owned: true, locked: false, impounded: false });
  reg.register({ id: 'car1', kind: 'hatchback', zone: 'village_coast', transform: T(5, 5), owned: true, locked: false, impounded: false });
  reg.register({ id: 'van1', kind: 'van', zone: 'city_old_market', transform: T(9, 9), owned: false, locked: true, impounded: false });
  reg.setGarage('village_coast', T(0, 0, Math.PI));
}

beforeEach(() => {
  reg = new VehicleRegistry();
  seed();
});

describe('registration', () => {
  it('keeps a record per vehicle', () => {
    expect(reg.size).toBe(3);
    expect(reg.get('car1')?.kind).toBe('hatchback');
    expect(reg.get('nope')).toBeNull();
  });

  it('fills a tank only for vehicles that have one', () => {
    // A bicycle registered with a fuel number must still end up with none.
    reg.register({ id: 'bike2', kind: 'bicycle', zone: 'village_coast', transform: T(), owned: true, locked: false, impounded: false, fuel: 40 });
    expect(reg.get('bike2')?.fuel).toBeNull();
    expect(reg.get('car1')?.fuel).toBeCloseTo(HATCHBACK.fuel!.capacity, 6);
  });

  it('starts vehicles in one piece', () => {
    expect(reg.get('car1')?.condition).toBe(1);
  });

  it('separates owned from merely present', () => {
    expect(reg.owned().map((r) => r.id).sort()).toEqual(['bike1', 'car1']);
  });

  it('lists what belongs in a zone', () => {
    expect(reg.inZone('village_coast').map((r) => r.id).sort()).toEqual(['bike1', 'car1']);
    expect(reg.inZone('city_old_market').map((r) => r.id)).toEqual(['van1']);
  });
});

describe('parking', () => {
  it('remembers where a vehicle was left', () => {
    reg.park('car1', 'city_old_market', T(42, -7, 1.2));
    const r = reg.get('car1')!;
    expect(r.zone).toBe('city_old_market');
    expect(r.transform.x).toBe(42);
    expect(r.transform.facing).toBeCloseTo(1.2, 6);
  });

  it('moves it out of the zone it came from', () => {
    reg.park('car1', 'city_old_market', T());
    expect(reg.inZone('village_coast').map((r) => r.id)).toEqual(['bike1']);
  });

  it('copies the transform rather than aliasing it', () => {
    const t = T(3, 3);
    reg.park('car1', 'village_coast', t);
    (t as { x: number }).x = 999;
    expect(reg.get('car1')!.transform.x).toBe(3);
  });
});

describe('damage is cosmetic and gradual', () => {
  it('ignores a nudge below the scratch threshold', () => {
    reg.damage('car1', HATCHBACK.damage.scratchSpeed - 0.5);
    expect(reg.get('car1')!.condition).toBe(1);
  });

  it('marks on a real impact', () => {
    reg.damage('car1', HATCHBACK.damage.dentSpeed);
    expect(reg.get('car1')!.condition).toBeLessThan(1);
  });

  it('costs more the harder the hit', () => {
    reg.damage('car1', HATCHBACK.damage.scratchSpeed + 0.5);
    const light = reg.get('car1')!.condition;
    reg.repair('car1');
    reg.damage('car1', HATCHBACK.damage.dentSpeed * 2);
    expect(reg.get('car1')!.condition).toBeLessThan(light);
  });

  it('never writes a vehicle off in one impact', () => {
    reg.damage('car1', 1000);
    expect(reg.get('car1')!.condition).toBeGreaterThan(0.5);
  });

  it('cannot go below zero however many times it is hit', () => {
    for (let i = 0; i < 200; i++) reg.damage('car1', 50);
    expect(reg.get('car1')!.condition).toBe(0);
  });

  it('repairs to pristine, and prices the job by how bad it is', () => {
    reg.damage('car1', HATCHBACK.damage.dentSpeed * 2);
    const cost = reg.repairCost('car1');
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(HATCHBACK.damage.repairCost);

    reg.repair('car1');
    expect(reg.get('car1')!.condition).toBe(1);
    expect(reg.repairCost('car1')).toBe(0);
  });

  it('survives a non-finite impact', () => {
    reg.damage('car1', Number.NaN);
    expect(reg.get('car1')!.condition).toBe(1);
  });
});

describe('fuel is optional and never applies to a bicycle', () => {
  it('burns over distance', () => {
    const before = reg.get('car1')!.fuel!;
    reg.consumeFuel('car1', 5000, true);
    expect(reg.get('car1')!.fuel!).toBeLessThan(before);
  });

  it('burns nothing when the system is switched off', () => {
    const before = reg.get('car1')!.fuel!;
    reg.consumeFuel('car1', 50_000, false);
    expect(reg.get('car1')!.fuel!).toBe(before);
  });

  it('never gives a bicycle a tank to empty', () => {
    expect(reg.consumeFuel('bike1', 100_000, true)).toBeNull();
    expect(reg.get('bike1')!.fuel).toBeNull();
    expect(reg.isOutOfFuel('bike1')).toBe(false);
    expect(BICYCLE.fuel).toBeNull();
  });

  it('stops at empty rather than going negative', () => {
    reg.consumeFuel('car1', 10_000_000, true);
    expect(reg.get('car1')!.fuel).toBe(0);
    expect(reg.isOutOfFuel('car1')).toBe(true);
  });

  it('refills to the definition’s capacity', () => {
    reg.consumeFuel('car1', 100_000, true);
    reg.refuel('car1');
    expect(reg.get('car1')!.fuel).toBeCloseTo(HATCHBACK.fuel!.capacity, 6);
  });

  it('drains a van faster than a hatchback over the same distance', () => {
    reg.park('van1', 'village_coast', T());
    const vanBefore = reg.get('van1')!.fuel!;
    const carBefore = reg.get('car1')!.fuel!;
    reg.consumeFuel('van1', 10_000, true);
    reg.consumeFuel('car1', 10_000, true);
    expect(vanBefore - reg.get('van1')!.fuel!).toBeGreaterThan(carBefore - reg.get('car1')!.fuel!);
    expect(VAN.fuel!.consumptionPerKm).toBeGreaterThan(HATCHBACK.fuel!.consumptionPerKm);
  });
});

describe('recovery', () => {
  it('spots a flipped vehicle', () => {
    const why = reg.needsRecovery('car1', { upright: false, y: 5, inBounds: true }, 0);
    expect(why).toBe('flipped');
  });

  it('spots one in the water', () => {
    expect(reg.needsRecovery('car1', { upright: true, y: -3, inBounds: true }, 0)).toBe('submerged');
  });

  it('spots one off the map', () => {
    expect(reg.needsRecovery('car1', { upright: true, y: 5, inBounds: false }, 0)).toBe('outOfBounds');
  });

  it('leaves a healthy vehicle alone', () => {
    expect(reg.needsRecovery('car1', { upright: true, y: 5, inBounds: true }, 0)).toBeNull();
  });

  it('brings it back to the garage, upright and released', () => {
    reg.park('car1', 'village_coast', T(400, 400));
    const r = reg.recover('car1', 'flipped');
    expect(r).not.toBeNull();
    expect(r!.transform.x).toBe(0);
    expect(r!.transform.facing).toBeCloseTo(Math.PI, 6);
    expect(r!.impounded).toBe(false);
  });

  it('recovers from every reason by the same route', () => {
    for (const why of ['flipped', 'submerged', 'outOfBounds', 'lost'] as const) {
      reg.park('car1', 'village_coast', T(999, 999));
      expect(reg.recover('car1', why)?.transform.x).toBe(0);
    }
  });

  it('does not quietly repair a wreck it recovers', () => {
    reg.damage('car1', 100);
    const before = reg.get('car1')!.condition;
    reg.recover('car1', 'flipped');
    expect(reg.get('car1')!.condition).toBeCloseTo(before, 9);
  });

  it('returns an impounded vehicle in working order, which is what the fee buys', () => {
    reg.damage('car1', 1000);
    reg.damage('car1', 1000);
    reg.damage('car1', 1000);
    reg.impound('car1');
    reg.recover('car1', 'impounded');
    expect(reg.get('car1')!.condition).toBeGreaterThanOrEqual(0.6);
    expect(reg.get('car1')!.impounded).toBe(false);
  });

  it('says no when the zone has no garage', () => {
    // A real answer, not an error: nothing can be recovered to a district
    // that has nowhere to put it.
    const bare = new VehicleRegistry();
    bare.register({ id: 'x', kind: 'hatchback', zone: 'city_downtown', transform: T(), owned: true, locked: false, impounded: false });
    expect(bare.recover('x', 'lost')).toBeNull();
  });

  it('falls back to the vehicle’s own zone garage when asked for one that has none', () => {
    reg.park('car1', 'village_coast', T(50, 50));
    expect(reg.recover('car1', 'lost', 'city_downtown')?.transform.x).toBe(0);
  });
});

describe('impound', () => {
  it('takes a car off the street', () => {
    reg.impound('car1');
    expect(reg.get('car1')!.impounded).toBe(true);
    expect(reg.inZone('village_coast').map((r) => r.id)).toEqual(['bike1']);
  });

  it('refuses to impound something the rules exempt', () => {
    // A bicycle is not impoundable, and the police car is not either.
    reg.impound('bike1');
    expect(reg.get('bike1')!.impounded).toBe(false);
    expect(BICYCLE.ownership.impoundable).toBe(false);
    expect(POLICE.ownership.impoundable).toBe(false);
  });

  it('reports impounded as the reason it needs recovering', () => {
    reg.impound('car1');
    expect(reg.needsRecovery('car1', { upright: true, y: 5, inBounds: true }, 0)).toBe('impounded');
  });
});

describe('persistence', () => {
  it('round trips', () => {
    reg.damage('car1', HATCHBACK.damage.dentSpeed);
    reg.consumeFuel('car1', 20_000, true);
    reg.setLocked('car1', true);
    reg.park('car1', 'city_old_market', T(12, -3, 0.7));

    const saved = reg.toJSON();
    const other = new VehicleRegistry();
    other.setRules(RULES);
    other.restore(saved);

    const a = reg.get('car1')!;
    const b = other.get('car1')!;
    expect(b.zone).toBe(a.zone);
    expect(b.locked).toBe(true);
    expect(b.condition).toBeCloseTo(a.condition, 9);
    expect(b.fuel).toBeCloseTo(a.fuel!, 9);
    expect(b.transform.facing).toBeCloseTo(0.7, 9);
  });

  it('drops a vehicle whose kind no longer exists', () => {
    // Same rule the inventory follows: a removed catalogue entry must not
    // come back as something with no definition behind it.
    const other = new VehicleRegistry();
    other.restore([
      { id: 'ghost', kind: 'hovercraft', zone: 'village_coast', position: { x: 0, y: 0, z: 0 }, facing: 0 },
      { id: 'real', kind: 'van', zone: 'village_coast', position: { x: 1, y: 0, z: 2 }, facing: 0 },
    ]);
    // Restore keeps both, because the catalogue may not be loaded yet. The
    // prune happens when the rules arrive, which is one step later and the
    // same outcome.
    expect(other.size).toBe(2);
    other.setRules(RULES);
    expect(other.size).toBe(1);
    expect(other.get('real')).not.toBeNull();
  });

  it('survives missing and malformed fields', () => {
    const other = new VehicleRegistry();
    other.setRules(RULES);
    other.restore([
      { id: 'a', kind: 'bicycle' },
      { kind: 'van' },
      { id: 'c', kind: 'hatchback', position: { x: 'no' }, condition: 'broken', fuel: 'lots' },
    ]);
    expect(other.size).toBe(2);
    expect(other.get('a')!.transform.x).toBe(0);
    expect(other.get('c')!.condition).toBe(1);
    expect(other.get('c')!.fuel).toBeCloseTo(HATCHBACK.fuel!.capacity, 6);
  });

  it('preserves the empty case', () => {
    const other = new VehicleRegistry();
    other.setRules(RULES);
    other.restore([]);
    expect(other.toJSON()).toEqual([]);
  });
});
