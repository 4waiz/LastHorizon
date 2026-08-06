import { describe, it, expect } from 'vitest';
import {
  BICYCLE, SCOOTER, HATCHBACK, VAN, POLICE, VEHICLES,
  gripAt, isTwoWheel, lodFor, steeringLimitAt, usesFuel,
  validateDefinition, validateFleet, vehicleDef,
  type VehicleDefinition,
} from '../src/vehicles/VehicleDefinition';
import { MAX_SPEED } from '../src/physics/PhysicsWorld';
import { ITEMS } from '../src/player/Inventory';

/** A definition with one field bent, to prove a specific check fires. */
function broken(base: VehicleDefinition, patch: Partial<VehicleDefinition>): VehicleDefinition {
  return { ...base, ...patch };
}

describe('the fleet is internally consistent', () => {
  it('every definition validates', () => {
    expect(validateFleet()).toEqual({});
  });

  it('covers the five classes the phase asks for', () => {
    expect(VEHICLES.map((v) => v.id).sort()).toEqual(
      ['bicycle', 'hatchback', 'police', 'scooter', 'van'],
    );
  });

  it('resolves by id and refuses an unknown one', () => {
    expect(vehicleDef('van')?.displayName).toBe('Delivery van');
    expect(vehicleDef('spaceship' as never)).toBeNull();
  });

  it('has unique ids and model names', () => {
    expect(new Set(VEHICLES.map((v) => v.id)).size).toBe(VEHICLES.length);
    expect(new Set(VEHICLES.map((v) => v.model)).size).toBe(VEHICLES.length);
  });

  it('gives every vehicle its own collision proxy, not the render mesh', () => {
    for (const v of VEHICLES) {
      expect(v.collisionProxy).not.toBe(v.model);
      expect(v.collisionProxy.length).toBeGreaterThan(0);
    }
  });
});

describe('the split that matters is kind, not id', () => {
  it('puts exactly the bicycle and scooter on two wheels', () => {
    expect(VEHICLES.filter(isTwoWheel).map((v) => v.id)).toEqual(['bicycle', 'scooter']);
  });

  it('gives every two-wheeler balance tuning and handlebars', () => {
    for (const v of VEHICLES.filter(isTwoWheel)) {
      expect(v.balance).not.toBeNull();
      expect(v.handlebarSockets).toHaveLength(2);
    }
  });

  it('gives no car a balance spec', () => {
    for (const v of VEHICLES.filter((x) => !isTwoWheel(x))) {
      expect(v.balance).toBeNull();
      expect(v.handlebarSockets).toBeNull();
    }
  });
});

describe('speeds stay inside the physics ceiling', () => {
  it('no vehicle asks to go faster than PhysicsWorld will allow', () => {
    // The clamp in PhysicsWorld is a backstop against solver blow-ups. If a
    // vehicle's own top speed reached it, the backstop would start firing in
    // ordinary play and the car would feel like it hit an invisible wall.
    for (const v of VEHICLES) {
      expect(v.drive.maxSpeed).toBeLessThan(MAX_SPEED);
    }
  });

  it('is ordered the way the fleet should feel', () => {
    expect(BICYCLE.drive.maxSpeed).toBeLessThan(SCOOTER.drive.maxSpeed);
    expect(SCOOTER.drive.maxSpeed).toBeLessThan(VAN.drive.maxSpeed);
    expect(VAN.drive.maxSpeed).toBeLessThan(HATCHBACK.drive.maxSpeed);
    expect(HATCHBACK.drive.maxSpeed).toBeLessThan(POLICE.drive.maxSpeed);
  });

  it('never reverses faster than it drives', () => {
    for (const v of VEHICLES) {
      expect(v.drive.maxReverseSpeed).toBeLessThan(v.drive.maxSpeed);
    }
  });
});

describe('fuel', () => {
  it('never applies to the bicycle', () => {
    // Stated in the brief and worth a test of its own: a pedal-powered vehicle
    // that can run out of fuel is a bug no amount of tuning fixes.
    expect(BICYCLE.fuel).toBeNull();
    expect(usesFuel(BICYCLE)).toBe(false);
  });

  it('applies to every engine-driven vehicle', () => {
    for (const v of VEHICLES.filter((x) => x.propulsion === 'engine')) {
      expect(v.fuel).not.toBeNull();
    }
  });

  it('rejects a pedal vehicle that was given a tank', () => {
    const errors = validateDefinition(broken(BICYCLE, {
      fuel: { capacity: 10, consumptionPerKm: 0.1, refillCost: 5 },
    }));
    expect(errors.join(' ')).toContain('pedal-powered vehicles must not define fuel');
  });
});

describe('ownership', () => {
  it('does not let the player own a police car', () => {
    expect(POLICE.ownership.ownable).toBe(false);
    expect(POLICE.ownership.price).toBeNull();
  });

  it('names a real catalogue item for every key it requires', () => {
    // A key item that does not exist means a vehicle nobody can ever enter.
    const catalogue = new Set(ITEMS.map((i) => i.id));
    for (const v of VEHICLES) {
      if (!v.ownership.requiresKey) continue;
      expect(v.ownership.keyItem).not.toBeNull();
      expect(catalogue.has(v.ownership.keyItem!)).toBe(true);
    }
  });

  it('rejects requiring a key without naming one', () => {
    const errors = validateDefinition(broken(HATCHBACK, {
      ownership: { ...HATCHBACK.ownership, keyItem: null },
    }));
    expect(errors.join(' ')).toContain('names no key item');
  });
});

describe('seats', () => {
  it('gives every vehicle exactly one driver', () => {
    for (const v of VEHICLES) {
      expect(v.seats.filter((s) => s.role === 'driver')).toHaveLength(1);
    }
  });

  it('supports passengers even though the MVP is single-player', () => {
    expect(HATCHBACK.seats.filter((s) => s.role === 'passenger').length).toBeGreaterThan(0);
    expect(VAN.seats.filter((s) => s.role === 'passenger')).toHaveLength(1);
  });

  it('gives each seat an exit that leads away from the vehicle', () => {
    for (const v of VEHICLES) {
      for (const s of v.seats) {
        const away = Math.hypot(s.exitOffset.x, s.exitOffset.z);
        expect(away).toBeGreaterThan(0.5);
      }
    }
  });

  it('rejects two drivers', () => {
    const errors = validateDefinition(broken(HATCHBACK, {
      seats: HATCHBACK.seats.map((s) => ({ ...s, role: 'driver' as const })),
    }));
    expect(errors.join(' ')).toContain('exactly one driver seat');
  });
});

describe('wheels', () => {
  it('gives every vehicle something powered, steered and braked', () => {
    for (const v of VEHICLES) {
      expect(v.wheels.some((w) => w.powered)).toBe(true);
      expect(v.wheels.some((w) => w.steered)).toBe(true);
      expect(v.wheels.some((w) => w.braked)).toBe(true);
    }
  });

  it('steers the front and drives the rear', () => {
    for (const v of VEHICLES) {
      for (const w of v.wheels) {
        if (w.steered) expect(w.position.z).toBeGreaterThan(0);
        if (w.powered) expect(w.position.z).toBeLessThan(0);
      }
    }
  });

  it('lays the four-wheelers out symmetrically', () => {
    for (const v of VEHICLES.filter((x) => !isTwoWheel(x))) {
      const xs = v.wheels.map((w) => w.position.x).sort((a, b) => a - b);
      // Mirrored about the centreline: -a, -a, +a, +a.
      expect(xs[0]).toBeCloseTo(-xs[3], 6);
      expect(xs[1]).toBeCloseTo(-xs[2], 6);
    }
  });

  it('rejects a car with the wrong number of wheels', () => {
    const errors = validateDefinition(broken(HATCHBACK, { wheels: HATCHBACK.wheels.slice(0, 3) }));
    expect(errors.join(' ')).toContain('needs 4 wheels');
  });

  it('rejects a two-wheeler with no balance spec', () => {
    const errors = validateDefinition(broken(SCOOTER, { balance: null }));
    expect(errors.join(' ')).toContain('needs a balance spec');
  });
});

describe('balance limits are limits', () => {
  it('caps recovery torque on every two-wheeler', () => {
    for (const v of VEHICLES.filter(isTwoWheel)) {
      expect(v.balance!.maxRecoveryTorque).toBeGreaterThan(0);
      expect(Number.isFinite(v.balance!.maxRecoveryTorque)).toBe(true);
    }
  });

  it('leaves room between leaning hard and falling over', () => {
    for (const v of VEHICLES.filter(isTwoWheel)) {
      expect(v.balance!.fallAngle).toBeGreaterThan(v.balance!.maxLean);
    }
  });

  it('rejects a fall angle inside the lean range', () => {
    const errors = validateDefinition(broken(BICYCLE, {
      balance: { ...BICYCLE.balance!, fallAngle: 0.2, maxLean: 0.42 },
    }));
    expect(errors.join(' ')).toContain('fallAngle must exceed maxLean');
  });
});

describe('steering falls off with speed', () => {
  it('gives full lock at a standstill', () => {
    expect(steeringLimitAt(HATCHBACK, 0)).toBeCloseTo(HATCHBACK.steering.maxAngle, 6);
  });

  it('tightens as the car speeds up', () => {
    const slow = steeringLimitAt(HATCHBACK, 2);
    const fast = steeringLimitAt(HATCHBACK, HATCHBACK.drive.maxSpeed);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeGreaterThan(0);
  });

  it('is symmetric — reversing steers the same as driving forward', () => {
    // Steering symmetry is an explicit acceptance criterion, and a sign error
    // here is exactly the kind of thing that only shows up in reverse.
    for (const v of VEHICLES) {
      for (const speed of [1, 5, 12]) {
        expect(steeringLimitAt(v, speed)).toBeCloseTo(steeringLimitAt(v, -speed), 9);
      }
    }
  });

  it('never inverts, however fast the input claims to be', () => {
    for (const v of VEHICLES) {
      expect(steeringLimitAt(v, 1e6)).toBeGreaterThan(0);
    }
  });
});

describe('grip', () => {
  it('is highest at parking speed and lowest flat out', () => {
    for (const v of VEHICLES) {
      expect(gripAt(v, 0)).toBeGreaterThan(gripAt(v, v.drive.maxSpeed));
    }
  });

  it('is symmetric in direction', () => {
    expect(gripAt(VAN, 8)).toBeCloseTo(gripAt(VAN, -8), 9);
  });

  it('never reaches zero, so a fast car still turns', () => {
    for (const v of VEHICLES) {
      expect(gripAt(v, v.drive.maxSpeed * 4)).toBeGreaterThan(0);
    }
  });

  it('gives the police car more grip than the hatchback it is based on', () => {
    expect(gripAt(POLICE, 15)).toBeGreaterThan(gripAt(HATCHBACK, 15));
  });
});

describe('level of detail', () => {
  it('uses the base mesh up close and a cheaper one far away', () => {
    expect(lodFor(HATCHBACK, 0)).toBe('');
    expect(lodFor(HATCHBACK, 40)).toBe('_LOD1');
    expect(lodFor(HATCHBACK, 200)).toBe('_LOD2');
  });

  it('orders distances so the walk picks the right level', () => {
    const errors = validateDefinition(broken(HATCHBACK, {
      lods: [{ distance: 80, suffix: '_LOD2' }, { distance: 10, suffix: '_LOD1' }],
    }));
    expect(errors.join(' ')).toContain('LOD distances must increase');
  });

  it('gives the simple two-wheelers fewer levels than the cars', () => {
    expect(BICYCLE.lods.length).toBeLessThan(HATCHBACK.lods.length);
  });
});

describe('damage is cosmetic and forgiving', () => {
  it('needs a harder hit to dent than to scratch', () => {
    for (const v of VEHICLES) {
      expect(v.damage.dentSpeed).toBeGreaterThan(v.damage.scratchSpeed);
    }
  });

  it('does not mark at kerb-nudging speed', () => {
    // Village driving involves kerbs. If they scratch, the calm exploration
    // feel goes with them.
    for (const v of VEHICLES) {
      expect(v.damage.scratchSpeed).toBeGreaterThan(2);
    }
  });

  it('rejects denting that is easier than scratching', () => {
    const errors = validateDefinition(broken(VAN, {
      damage: { ...VAN.damage, dentSpeed: 1, scratchSpeed: 5 },
    }));
    expect(errors.join(' ')).toContain('denting must need a harder hit');
  });
});

describe('the police variant', () => {
  it('is a hatchback underneath', () => {
    expect(POLICE.kind).toBe(HATCHBACK.kind);
    expect(POLICE.seats).toEqual(HATCHBACK.seats);
    expect(POLICE.dimensions).toEqual(HATCHBACK.dimensions);
  });

  it('is quicker than the car it is based on', () => {
    expect(POLICE.drive.maxSpeed).toBeGreaterThan(HATCHBACK.drive.maxSpeed);
    expect(POLICE.drive.zeroToTopSeconds).toBeLessThan(HATCHBACK.drive.zeroToTopSeconds);
  });

  it('carries a beacon the hatchback does not', () => {
    expect(POLICE.lights.some((l) => l.role === 'beacon')).toBe(true);
    expect(HATCHBACK.lights.some((l) => l.role === 'beacon')).toBe(false);
  });
});

describe('lights', () => {
  it('gives everything a headlight and a brake light', () => {
    for (const v of VEHICLES) {
      expect(v.lights.some((l) => l.role === 'headlight')).toBe(true);
      expect(v.lights.some((l) => l.role === 'brake')).toBe(true);
    }
  });

  it('puts headlights in front and brake lights behind', () => {
    for (const v of VEHICLES) {
      for (const l of v.lights) {
        if (l.role === 'headlight') expect(l.position.z).toBeGreaterThan(0);
        if (l.role === 'brake') expect(l.position.z).toBeLessThan(0);
      }
    }
  });

  it('has unique light ids per vehicle', () => {
    for (const v of VEHICLES) {
      expect(new Set(v.lights.map((l) => l.id)).size).toBe(v.lights.length);
    }
  });
});

describe('spawn rules', () => {
  it('asks for clearance proportional to size', () => {
    for (const v of VEHICLES) {
      expect(v.spawn.clearance).toBeGreaterThan(v.dimensions.x / 2);
    }
  });

  it('keeps cars on roads and lets bicycles off them', () => {
    expect(BICYCLE.spawn.requiresRoad).toBe(false);
    expect(HATCHBACK.spawn.requiresRoad).toBe(true);
    expect(VAN.spawn.requiresRoad).toBe(true);
  });

  it('allows a bicycle onto steeper ground than a van', () => {
    expect(BICYCLE.spawn.maxSlope).toBeGreaterThan(VAN.spawn.maxSlope);
  });
});

describe('mass and suspension are plausible', () => {
  it('orders mass the way the fleet should feel', () => {
    expect(BICYCLE.mass).toBeLessThan(SCOOTER.mass);
    expect(SCOOTER.mass).toBeLessThan(HATCHBACK.mass);
    expect(HATCHBACK.mass).toBeLessThan(VAN.mass);
  });

  it('caps suspension force on every vehicle', () => {
    for (const v of VEHICLES) {
      expect(v.suspension.maxForce).toBeGreaterThan(0);
      expect(Number.isFinite(v.suspension.maxForce)).toBe(true);
    }
  });

  it('can hold its own weight on the suspension it has', () => {
    // Four wheels at max force must beat the static load, or the vehicle sits
    // on its bump stops and every bump sends it through the floor.
    for (const v of VEHICLES) {
      const capacity = v.suspension.maxForce * v.wheels.length;
      expect(capacity).toBeGreaterThan(v.mass * 9.81);
    }
  });

  it('puts the centre of mass low', () => {
    for (const v of VEHICLES) {
      expect(v.centreOfMass.y).toBeLessThan(v.dimensions.y / 2);
    }
  });

  it('gives the van a higher centre of mass than the hatchback', () => {
    expect(VAN.centreOfMass.y).toBeGreaterThan(HATCHBACK.centreOfMass.y);
  });
});
