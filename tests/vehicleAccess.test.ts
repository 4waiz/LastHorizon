import { describe, it, expect } from 'vitest';
import { BICYCLE, HATCHBACK, POLICE, VAN, VEHICLES } from '../src/vehicles/VehicleDefinition';
import {
  MAX_EXIT_DROP, MAX_EXIT_SPEED, PERSON_RADIUS,
  canEnter, entryRefusalText, exitPlacement, exitRefusalText,
  nearestSeat, seatWorldPosition, toWorld,
  type PlacementProbe, type VehiclePose,
} from '../src/vehicles/VehicleAccess';

const pose = (over: Partial<VehiclePose> = {}): VehiclePose => ({
  position: { x: 0, y: 1, z: 0 },
  yaw: 0,
  speed: 0,
  ...over,
});

/** Flat ground at y=1, nothing in the way. */
const openGround: PlacementProbe = {
  groundAt: () => 1,
  isClear: () => true,
};

/** Ground everywhere, but solid rock above it. */
const wallEverywhere: PlacementProbe = {
  groundAt: () => 1,
  isClear: () => false,
};

/** No ground at all — the vehicle is parked on a ledge. */
const voidEverywhere: PlacementProbe = {
  groundAt: () => null,
  isClear: () => true,
};

/** Ground only where `inside` says so; elsewhere a sheer drop. */
function cliff(inside: (x: number, z: number) => boolean): PlacementProbe {
  return { groundAt: (x, z) => (inside(x, z) ? 1 : null), isClear: () => true };
}

/** Ground everywhere; obstruction only where `blocked` says so. */
function obstacle(blocked: (x: number, z: number) => boolean): PlacementProbe {
  return { groundAt: () => 1, isClear: (x, _y, z) => !blocked(x, z) };
}

const driverSeat = (def = HATCHBACK) => def.seats.find((s) => s.role === 'driver')!;

describe('local to world', () => {
  it('places an offset relative to the vehicle when unrotated', () => {
    const p = toWorld(pose(), { x: 1, y: 0, z: 2 });
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.z).toBeCloseTo(2, 6);
  });

  it('rotates with the vehicle', () => {
    // Yawed a quarter turn, the car's left becomes world +Z... or -Z; what
    // matters is that a purely sideways offset stops being purely sideways.
    const p = toWorld(pose({ yaw: Math.PI / 2 }), { x: 1, y: 0, z: 0 });
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.z)).toBeCloseTo(1, 6);
  });

  it('carries the vehicle position with it', () => {
    const p = toWorld(pose({ position: { x: 10, y: 3, z: -4 } }), { x: 0, y: 0, z: 0 });
    expect(p).toEqual({ x: 10, y: 3, z: -4 });
  });
});

describe('exit: the vehicle must be stopped', () => {
  it('refuses while moving', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose({ speed: 12 }), openGround);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('moving');
  });

  it('refuses while rolling backwards just as fast', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose({ speed: -12 }), openGround);
    expect(r.ok === false && r.reason).toBe('moving');
  });

  it('allows a crawl, because a parked car is never exactly still', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose({ speed: MAX_EXIT_SPEED * 0.5 }), openGround);
    expect(r.ok).toBe(true);
  });

  it('refuses a non-finite speed rather than trusting it', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose({ speed: Number.NaN }), openGround);
    expect(r.ok === false && r.reason).toBe('moving');
  });
});

describe('exit: not over a cliff', () => {
  it('refuses when there is no ground anywhere', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), voidEverywhere);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('noGround');
  });

  it('steps out the other side when the near side is a drop', () => {
    // Ground only on the car's right. The driver sits on the left, so the
    // first candidate is over the edge and the mirrored one is not.
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), cliff((x) => x > 0));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.position.x).toBeGreaterThan(0);
      expect(r.fallback).toBe(true);
    }
  });

  it('refuses a long drop even where there is ground', () => {
    // Ground exists, but a long way down: a ledge, not a kerb.
    const deep: PlacementProbe = { groundAt: () => -50, isClear: () => true };
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), deep);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('drop');
  });

  it('accepts a step down onto a kerb', () => {
    const kerb: PlacementProbe = {
      groundAt: () => 1 - MAX_EXIT_DROP * 0.5,
      isClear: () => true,
    };
    expect(exitPlacement(HATCHBACK, driverSeat(), pose(), kerb).ok).toBe(true);
  });
});

describe('exit: not inside a wall', () => {
  it('refuses when every candidate is blocked', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), wallEverywhere);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('blocked');
  });

  it('goes round to a clear side', () => {
    // A wall down the car's left, where the driver's door is.
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), obstacle((x) => x < 0));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.position.x).toBeGreaterThan(0);
      expect(r.fallback).toBe(true);
    }
  });

  it('falls back to behind the vehicle when both sides are walled in', () => {
    // Parked in a narrow alley: both sides solid, the back is open.
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), obstacle((_x, z) => z > -2));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.position.z).toBeLessThan(-2);
  });

  it('checks clearance at ground level, not at seat height', () => {
    // Clear at y=1 (the ground) but solid higher up would still be walked
    // into. The probe is asked about the spot the player will actually stand.
    const seen: number[] = [];
    const probe: PlacementProbe = {
      groundAt: () => 0.2,
      isClear: (_x, y) => {
        seen.push(y);
        return true;
      },
    };
    exitPlacement(HATCHBACK, driverSeat(), pose(), probe);
    expect(seen.every((y) => Math.abs(y - 0.2) < 1e-9)).toBe(true);
  });

  it('asks for a person-sized space', () => {
    const radii: number[] = [];
    const probe: PlacementProbe = {
      groundAt: () => 1,
      isClear: (_x, _y, _z, r) => {
        radii.push(r);
        return true;
      },
    };
    exitPlacement(HATCHBACK, driverSeat(), pose(), probe);
    expect(radii[0]).toBeCloseTo(PERSON_RADIUS, 9);
  });
});

describe('exit: the happy path', () => {
  it('uses the seat’s own door when it is clear', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), openGround);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fallback).toBe(false);
      // The driver's door is on the car's left, which is -x unrotated.
      expect(r.position.x).toBeLessThan(0);
    }
  });

  it('puts the player on the ground, not at seat height', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose(), openGround);
    expect(r.ok && r.position.y).toBe(1);
  });

  it('follows the vehicle when it is parked at an angle', () => {
    const r = exitPlacement(HATCHBACK, driverSeat(), pose({ yaw: Math.PI / 2 }), openGround);
    expect(r.ok).toBe(true);
    // Turned a quarter turn, a sideways door is no longer sideways in world.
    if (r.ok) expect(Math.abs(r.position.z)).toBeGreaterThan(0.5);
  });

  it('works for every seat of every vehicle', () => {
    for (const def of VEHICLES) {
      for (const seat of def.seats) {
        const r = exitPlacement(def, seat, pose(), openGround);
        expect(r.ok, `${def.id}/${seat.id} could not get out`).toBe(true);
      }
    }
  });

  it('explains itself when it refuses', () => {
    for (const reason of ['moving', 'blocked', 'noGround', 'drop'] as const) {
      expect(exitRefusalText(reason).length).toBeGreaterThan(4);
    }
  });
});

describe('choosing a door', () => {
  it('picks the seat the player is standing beside', () => {
    // Standing well out on the car's right.
    const right = nearestSeat(HATCHBACK, pose(), { x: 4, y: 0, z: 0.2 });
    expect(right?.seat.door).toBe('right');

    const left = nearestSeat(HATCHBACK, pose(), { x: -4, y: 0, z: 0.2 });
    expect(left?.seat.door).toBe('left');
  });

  it('can be restricted to the driver', () => {
    const s = nearestSeat(HATCHBACK, pose(), { x: 4, y: 0, z: 0 }, { driverOnly: true });
    expect(s?.seat.role).toBe('driver');
  });

  it('reports how far away that door is', () => {
    const s = nearestSeat(HATCHBACK, pose(), { x: 40, y: 0, z: 0 });
    expect(s!.distance).toBeGreaterThan(35);
  });

  it('follows the vehicle’s rotation', () => {
    // Rotated 180 degrees, the car's left door faces world +x.
    const turned = pose({ yaw: Math.PI });
    const s = nearestSeat(HATCHBACK, turned, { x: 4, y: 0, z: 0 });
    expect(s?.seat.door).toBe('left');
  });

  it('handles a single-seat vehicle', () => {
    const s = nearestSeat(BICYCLE, pose(), { x: 3, y: 0, z: 0 });
    expect(s?.seat.role).toBe('driver');
    expect(s?.seat.door).toBe('straddle');
  });
});

describe('permission to get in', () => {
  const ctx = (over: Partial<{ keys: string[]; locked: boolean; occupied: string[] }> = {}) => ({
    keys: new Set(over.keys ?? []),
    locked: over.locked ?? false,
    occupied: new Set(over.occupied ?? []),
  });

  it('lets the player into an unlocked bicycle with no key', () => {
    const r = canEnter(BICYCLE, BICYCLE.seats[0], pose(), ctx());
    expect(r.ok).toBe(true);
  });

  it('refuses a car that needs a key the player does not have', () => {
    const r = canEnter(HATCHBACK, driverSeat(), pose(), ctx());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('noKey');
  });

  it('lets the key holder in', () => {
    const r = canEnter(HATCHBACK, driverSeat(), pose(), ctx({ keys: ['keys_hatchback'] }));
    expect(r.ok).toBe(true);
  });

  it('lets the key holder into a locked vehicle, which is the point of a key', () => {
    const r = canEnter(HATCHBACK, driverSeat(), pose(),
      ctx({ keys: ['keys_hatchback'], locked: true }));
    expect(r.ok).toBe(true);
  });

  it('refuses a locked vehicle without its key', () => {
    const r = canEnter(HATCHBACK, driverSeat(), pose(), ctx({ locked: true }));
    expect(r.ok === false && r.reason).toBe('locked');
  });

  it('does not demand a key for an unlocked vehicle that never needed one', () => {
    // Checking the key before the lock would make every bicycle need one.
    const r = canEnter(BICYCLE, BICYCLE.seats[0], pose(), ctx({ locked: false }));
    expect(r.ok).toBe(true);
  });

  it('refuses a seat someone is already in', () => {
    const seat = driverSeat();
    const r = canEnter(HATCHBACK, seat, pose(),
      ctx({ keys: ['keys_hatchback'], occupied: [seat.id] }));
    expect(r.ok === false && r.reason).toBe('occupied');
  });

  it('refuses a vehicle that is still rolling', () => {
    const r = canEnter(HATCHBACK, driverSeat(), pose({ speed: 8 }),
      ctx({ keys: ['keys_hatchback'] }));
    expect(r.ok === false && r.reason).toBe('moving');
  });

  it('keeps the police car behind its own key', () => {
    expect(POLICE.ownership.requiresKey).toBe(true);
    const r = canEnter(POLICE, POLICE.seats[0], pose(), ctx());
    expect(r.ok === false && r.reason).toBe('noKey');
  });

  it('explains itself when it refuses', () => {
    for (const reason of ['locked', 'noKey', 'moving', 'occupied'] as const) {
      expect(entryRefusalText(reason).length).toBeGreaterThan(4);
    }
  });
});

describe('where the occupant sits', () => {
  it('is inside the vehicle, not beside it', () => {
    const seat = driverSeat(VAN);
    const at = seatWorldPosition(pose(), seat);
    const door = toWorld(pose(), seat.exitOffset);
    // The seat is nearer the centreline than the door it is reached through.
    expect(Math.abs(at.x)).toBeLessThan(Math.abs(door.x));
  });

  it('moves with the vehicle', () => {
    const seat = driverSeat();
    const a = seatWorldPosition(pose({ position: { x: 0, y: 1, z: 0 } }), seat);
    const b = seatWorldPosition(pose({ position: { x: 10, y: 1, z: 0 } }), seat);
    expect(b.x - a.x).toBeCloseTo(10, 6);
  });
});
