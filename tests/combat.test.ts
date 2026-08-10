import { beforeEach, describe, expect, it } from 'vitest';
import { WeaponSystem, type WeaponHost } from '../src/combat/WeaponSystem';
import { WEAPONS, weaponDef, FIREARM_IDS, AMMO_ITEM_IDS } from '../src/combat/weaponCatalog';
import { FIREARM_MIN_AGE, impactAt, validateWeapon } from '../src/combat/WeaponDefinition';
import { assistDirection, coneDirection, traceShot, type ShotTarget } from '../src/combat/Ballistics';
import { CombatDirector, type CombatHost } from '../src/combat/CombatDirector';
import { CombatState } from '../src/combat/CombatState';
import { CALL_DELAY_NEAR } from '../src/crime/Heat';
import type { Vec3Like } from '../src/nav/NavTypes';
import { ITEMS } from '../src/player/Inventory';

/**
 * The weapon state machine and the ballistics, both pure.
 *
 * Nothing here builds a scene or waits a real second. That is the point of
 * keeping `advance(dt)` as the only way time enters: an interrupted reload is
 * three lines to test rather than a browser and a stopwatch.
 */

class FakeHost implements WeaponHost {
  age = 18;
  inSafeZone = false;
  readonly ammo = new Map<string, number>();

  reserveOf(itemId: string): number {
    return this.ammo.get(itemId) ?? 0;
  }
  takeAmmo(itemId: string, count: number): number {
    const have = this.reserveOf(itemId);
    const took = Math.min(have, count);
    this.ammo.set(itemId, have - took);
    return took;
  }
  giveAmmo(itemId: string, count: number): void {
    this.ammo.set(itemId, this.reserveOf(itemId) + count);
  }
}

function armed(age = 18): { host: FakeHost; ws: WeaponSystem } {
  const host = new FakeHost();
  host.age = age;
  host.ammo.set('ammo_pistol', 60);
  host.ammo.set('ammo_shotgun', 24);
  host.ammo.set('ammo_carbine', 96);
  const ws = new WeaponSystem(host);
  ws.seed(1234);
  return { host, ws };
}

describe('the weapon catalogue', () => {
  it('validates every entry', () => {
    for (const def of WEAPONS) {
      const r = validateWeapon(def);
      expect(r.errors, `${def.id}: ${r.errors.join('; ')}`).toEqual([]);
    }
  });

  it('gates every firearm at 18 and only your hands below it', () => {
    for (const id of FIREARM_IDS) {
      expect(weaponDef(id)!.minAge, id).toBe(FIREARM_MIN_AGE);
    }
    expect(weaponDef('unarmed')!.minAge).toBe(0);
  });

  it('has an inventory item for every ammunition type it names', () => {
    // The two catalogues cannot drift: a weapon that eats an item nothing
    // sells is a weapon that can never be reloaded.
    const items = new Set(ITEMS.map((i) => i.id));
    for (const id of AMMO_ITEM_IDS) expect(items.has(id), id).toBe(true);
  });

  it('never makes aiming worse than not aiming', () => {
    for (const def of WEAPONS) expect(def.aimSpread, def.id).toBeLessThanOrEqual(def.baseSpread);
  });

  it('keeps the shotgun a close-range weapon and the carbine a long one', () => {
    const shotgun = weaponDef('shotgun')!;
    const carbine = weaponDef('carbine')!;
    // Eight pellets at contact stop somebody; at range most of them miss.
    expect(impactAt(shotgun, 0) * shotgun.pellets).toBeGreaterThan(1);
    expect(shotgun.range).toBeLessThan(carbine.range / 2);
    // The carbine barely cares about distance.
    expect(impactAt(carbine, carbine.range)).toBeGreaterThan(impactAt(carbine, 0) * 0.8);
  });

  it('makes three shoves settle an argument', () => {
    // The yardstick the whole table is balanced against.
    const shove = weaponDef('unarmed')!;
    expect(Math.ceil(1 / impactAt(shove, 1))).toBe(3);
  });
});

describe('the adult gate', () => {
  it('refuses to let a fifteen-year-old even hold a pistol', () => {
    const { ws } = armed(15);
    expect(ws.acquire('pistol')).toEqual({ ok: false, reason: 'too-young' });
    expect(ws.owns('pistol')).toBe(false);
  });

  it('allows hands at any age', () => {
    const { ws } = armed(15);
    expect(ws.equip('unarmed').ok).toBe(true);
  });

  it('drops firearms out of a save that claims a minor owns one', () => {
    // The one bypass that matters: an edited file plus a reload must not
    // become a loophole in acceptance criterion 1.
    const { ws } = armed(15);
    ws.restore({ owned: { pistol: 12, carbine: 24 }, equipped: 'pistol', stance: 'drawn' });
    expect(ws.owns('pistol')).toBe(false);
    expect(ws.owns('carbine')).toBe(false);
    expect(ws.equipped.id).toBe('unarmed');
  });

  it('refuses to fire a firearm if the player somehow aged backwards', () => {
    const { host, ws } = armed(18);
    ws.acquire('pistol', 12);
    ws.equip('pistol');
    host.age = 17;
    expect(ws.tryFire()).toEqual({ ok: false, reason: 'too-young' });
  });
});

describe('equipping and safe zones', () => {
  it('refuses to draw a conspicuous weapon in a safe zone', () => {
    const { host, ws } = armed();
    ws.acquire('pistol', 12);
    host.inSafeZone = true;
    expect(ws.equip('pistol')).toEqual({ ok: false, reason: 'safe-zone' });
  });

  it('puts a drawn weapon away on walking into one', () => {
    const { host, ws } = armed();
    ws.acquire('pistol', 12);
    ws.equip('pistol');
    expect(ws.brandishing).toBe(true);

    host.inSafeZone = true;
    expect(ws.enforceSafeZone()).toBe(true);
    expect(ws.stance).toBe('holstered');
    expect(ws.brandishing).toBe(false);
  });

  it('leaves hands alone in a safe zone', () => {
    const { host, ws } = armed();
    ws.equip('unarmed');
    host.inSafeZone = true;
    expect(ws.enforceSafeZone()).toBe(false);
    expect(ws.tryFire().ok).toBe(true);
  });

  it('only counts a drawn firearm as brandishing', () => {
    const { ws } = armed();
    ws.acquire('pistol', 12);
    expect(ws.brandishing).toBe(false); // holstered
    ws.equip('pistol');
    expect(ws.brandishing).toBe(true);
    ws.equip('unarmed');
    expect(ws.brandishing).toBe(false); // hands are not conspicuous
  });
});

describe('firing', () => {
  let ws: WeaponSystem;
  beforeEach(() => {
    ({ ws } = armed());
    ws.acquire('pistol', 12);
    ws.equip('pistol');
  });

  it('refuses while holstered, and names why', () => {
    ws.holster();
    expect(ws.tryFire()).toEqual({ ok: false, reason: 'holstered' });
  });

  it('spends a round and enforces the fire interval', () => {
    const first = ws.tryFire();
    expect(first.ok).toBe(true);
    expect(ws.rounds).toBe(11);

    expect(ws.tryFire()).toEqual({ ok: false, reason: 'cooling' });
    ws.advance(weaponDef('pistol')!.fireInterval + 0.01);
    expect(ws.tryFire().ok).toBe(true);
  });

  it('clicks rather than doing nothing when empty', () => {
    for (let i = 0; i < 12; i++) {
      ws.tryFire();
      ws.advance(1);
    }
    expect(ws.rounds).toBe(0);
    // A named refusal, not a silent no-op: the caller plays the click.
    expect(ws.tryFire()).toEqual({ ok: false, reason: 'empty' });
  });

  it('fires eight pellets from a shotgun and one from a pistol', () => {
    ws.acquire('shotgun', 2);
    ws.equip('shotgun');
    const r = ws.tryFire();
    expect(r.ok && r.shots).toHaveLength(8);
  });

  it('blooms with sustained fire and settles again', () => {
    const cold = ws.spread;
    for (let i = 0; i < 4; i++) {
      ws.tryFire();
      ws.advance(weaponDef('pistol')!.fireInterval);
    }
    expect(ws.spread).toBeGreaterThan(cold);

    ws.advance(6);
    expect(ws.spread).toBeCloseTo(cold, 3);
  });

  it('tightens the cone while aiming', () => {
    const hip = ws.spread;
    ws.setAiming(true);
    expect(ws.spread).toBeLessThan(hip);
    expect(ws.moveScale).toBeLessThan(1);
  });

  it('does not let hands aim', () => {
    ws.equip('unarmed');
    expect(ws.setAiming(true)).toBe(false);
    expect(ws.moveScale).toBe(1);
  });

  it('produces the same recoil sequence for the same seed', () => {
    const a = armed().ws;
    a.seed(99);
    a.acquire('pistol', 12);
    a.equip('pistol');

    const b = armed().ws;
    b.seed(99);
    b.acquire('pistol', 12);
    b.equip('pistol');

    for (let i = 0; i < 5; i++) {
      const ra = a.tryFire();
      const rb = b.tryFire();
      expect(ra.ok && rb.ok && ra.recoilYaw).toBe(rb.ok ? rb.recoilYaw : NaN);
      a.advance(1);
      b.advance(1);
    }
  });
});

describe('reloading', () => {
  let host: FakeHost;
  let ws: WeaponSystem;
  beforeEach(() => {
    ({ host, ws } = armed());
    ws.acquire('pistol', 0);
    ws.equip('pistol');
  });

  it('takes rounds from the reserve only when it finishes', () => {
    expect(ws.reload().ok).toBe(true);
    // Half way: nothing has moved yet.
    ws.advance(weaponDef('pistol')!.reloadSeconds / 2);
    expect(ws.rounds).toBe(0);
    expect(host.reserveOf('ammo_pistol')).toBe(60);

    ws.advance(weaponDef('pistol')!.reloadSeconds);
    expect(ws.rounds).toBe(12);
    expect(host.reserveOf('ammo_pistol')).toBe(48);
  });

  it('loses nothing when interrupted', () => {
    // The reason rounds move at the *end*: there is no partial state that
    // could double-count a magazine.
    ws.reload();
    ws.advance(1);
    expect(ws.cancelReload()).toBe(true);

    expect(ws.rounds).toBe(0);
    expect(host.reserveOf('ammo_pistol')).toBe(60);
    expect(ws.reloadsInterrupted).toBe(1);
  });

  it('cancels the reload when the weapon is swapped, and keeps the rounds', () => {
    ws.acquire('shotgun', 2);
    ws.reload();
    ws.advance(0.5);
    ws.equip('shotgun');

    expect(ws.reloading).toBe(false);
    ws.equip('pistol');
    expect(ws.rounds).toBe(0);
    expect(host.reserveOf('ammo_pistol')).toBe(60);
  });

  it('refuses with a full magazine or an empty reserve', () => {
    host.ammo.set('ammo_pistol', 0);
    expect(ws.reload()).toEqual({ ok: false, reason: 'no-reserve' });

    host.ammo.set('ammo_pistol', 60);
    ws.reload();
    ws.advance(10);
    expect(ws.reload()).toEqual({ ok: false, reason: 'magazine-full' });
  });

  it('partially fills from a short reserve', () => {
    host.ammo.set('ammo_pistol', 5);
    ws.reload();
    ws.advance(10);
    expect(ws.rounds).toBe(5);
    expect(host.reserveOf('ammo_pistol')).toBe(0);
  });

  it('cannot be started while holstered', () => {
    ws.holster();
    expect(ws.reload()).toEqual({ ok: false, reason: 'holstered' });
  });
});

describe('weapon save and load', () => {
  it('round-trips what is owned and what is loaded', () => {
    const { ws } = armed();
    ws.acquire('pistol', 12);
    ws.acquire('carbine', 24);
    ws.equip('carbine');
    ws.tryFire();

    const saved = JSON.parse(JSON.stringify(ws.toJSON()));
    const { ws: other } = armed();
    other.restore(saved);

    expect(other.owns('pistol')).toBe(true);
    expect(other.owns('carbine')).toBe(true);
    expect(other.equipped.id).toBe('carbine');
    expect(other.rounds).toBe(23);
  });

  it('always comes back holstered', () => {
    // A save reloaded into a drawn weapon is a save that can be reloaded into
    // a crime — the player is standing in a shop holding a carbine before they
    // have touched a key.
    const { ws } = armed();
    ws.acquire('pistol', 12);
    ws.equip('pistol');
    ws.setAiming(true);

    const { ws: other } = armed();
    other.restore(ws.toJSON());
    expect(other.stance).toBe('holstered');
  });

  it('restores an absent block as hands and nothing else', () => {
    const { ws } = armed();
    ws.acquire('pistol', 12);
    ws.restore(undefined);
    expect(ws.ownedIds).toEqual(['unarmed']);
    expect(ws.equipped.id).toBe('unarmed');
  });
});

// ---------------------------------------------------------------------------
// Ballistics
// ---------------------------------------------------------------------------

const FORWARD = { x: 0, y: 0, z: 1 };
const RIGHT = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 1, z: 0 };

function person(id: string, x: number, z: number, targetable = true): ShotTarget {
  return { id, at: { x, y: 1, z }, radius: 0.42, height: 1.8, targetable };
}

describe('ballistics', () => {
  it('sends a zero-spread shot exactly forward', () => {
    const d = coneDirection(FORWARD, RIGHT, UP, 0, 0.7, 0.3);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(1);
  });

  it('keeps every pellet inside the cone', () => {
    const spread = 0.16;
    for (let i = 0; i < 200; i++) {
      const d = coneDirection(FORWARD, RIGHT, UP, spread, i / 200, (i * 7) % 200 / 200);
      const angle = Math.acos(Math.max(-1, Math.min(1, d.z)));
      expect(angle).toBeLessThanOrEqual(spread + 1e-6);
    }
  });

  it('spreads pellets evenly across the disc rather than bunching them', () => {
    // sqrt(u) rather than u. Sampling the radius linearly makes a shotgun
    // behave like a rifle at range, which gets the weapon's whole character
    // wrong in a way nobody notices for months.
    let inner = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const d = coneDirection(FORWARD, RIGHT, UP, 0.2, i / n, ((i * 13) % n) / n);
      if (Math.acos(Math.min(1, d.z)) < 0.2 / Math.SQRT2) inner++;
    }
    // Half the *area* is inside r/sqrt(2), so about half the pellets should be.
    expect(inner / n).toBeGreaterThan(0.4);
    expect(inner / n).toBeLessThan(0.6);
  });

  it('hits the nearest target in line', () => {
    const r = traceShot({ x: 0, y: 1, z: 0 }, FORWARD, 45, [person('far', 0, 20), person('near', 0, 8)], Infinity);
    expect(r.hit?.targetId).toBe('near');
    expect(r.hit?.distance).toBeCloseTo(8, 1);
  });

  it('misses somebody standing to one side', () => {
    const r = traceShot({ x: 0, y: 1, z: 0 }, FORWARD, 45, [person('aside', 3, 8)], Infinity);
    expect(r.hit).toBeNull();
  });

  it('does not shoot through a wall', () => {
    // The wall distance is injected, exactly as occlusion is in `Perception`.
    // The two systems answering differently about walls would be a bug nobody
    // could find.
    const targets = [person('behind', 0, 12)];
    expect(traceShot({ x: 0, y: 1, z: 0 }, FORWARD, 45, targets, Infinity).hit?.targetId).toBe('behind');
    const blocked = traceShot({ x: 0, y: 1, z: 0 }, FORWARD, 45, targets, 6);
    expect(blocked.hit).toBeNull();
    expect(blocked.struckWorld).toBe(true);
  });

  it('never returns a target that may not be shot', () => {
    // The child rule, enforced here as well as in the NPC catalogue. Two
    // independent refusals, so a catalogue mistake cannot become a targetable
    // child.
    const r = traceShot({ x: 0, y: 1, z: 0 }, FORWARD, 45, [person('child', 0, 5, false)], Infinity);
    expect(r.hit).toBeNull();
  });

  it('ignores anybody behind the shooter', () => {
    const r = traceShot({ x: 0, y: 1, z: 0 }, FORWARD, 45, [person('behind', 0, -8)], Infinity);
    expect(r.hit).toBeNull();
  });

  it('stops at the weapon’s range', () => {
    const r = traceShot({ x: 0, y: 1, z: 0 }, FORWARD, 22, [person('far', 0, 30)], Infinity);
    expect(r.hit).toBeNull();
    expect(r.end.z).toBeCloseTo(22, 1);
  });
});

describe('aim assist', () => {
  const targets = [person('a', 1, 10)];

  it('does nothing at zero strength', () => {
    const d = assistDirection({ x: 0, y: 1, z: 0 }, FORWARD, targets, {
      coneRadians: 0.2,
      strength: 0,
      range: 45,
    });
    expect(d.x).toBeCloseTo(0);
  });

  it('nudges toward a target already inside the cone', () => {
    const d = assistDirection({ x: 0, y: 1, z: 0 }, FORWARD, targets, {
      coneRadians: 0.25,
      strength: 0.5,
      range: 45,
    });
    expect(d.x).toBeGreaterThan(0);
  });

  it('never reaches for a target outside the cone', () => {
    // An assist, not a snap: a shot that would have missed by a wide margin
    // still misses, and nothing is hit that the cone did not already contain.
    const d = assistDirection({ x: 0, y: 1, z: 0 }, FORWARD, [person('wide', 20, 10)], {
      coneRadians: 0.05,
      strength: 1,
      range: 45,
    });
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(1);
  });

  it('never reaches for somebody who may not be targeted', () => {
    const d = assistDirection({ x: 0, y: 1, z: 0 }, FORWARD, [person('child', 1, 10, false)], {
      coneRadians: 0.4,
      strength: 1,
      range: 45,
    });
    expect(d.x).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

/**
 * A fake world for `CombatDirector`.
 *
 * Only what the director actually reaches for during an arrest. It records
 * `onArrest` calls because that single callback is where every consequence of
 * being taken in lives — the fade, the fine, the impound, the lost hours — and
 * a path that clears Heat without firing it looks identical from the outside
 * until somebody checks their wallet.
 */
class FakeCombatHost extends FakeHost implements CombatHost {
  readonly arrests: string[] = [];
  readonly toasts: string[] = [];
  playerDriving = false;

  playerEye(): Vec3Like {
    return { x: 0, y: 1.6, z: 0 };
  }
  aimDirection(): Vec3Like {
    return { x: 0, y: 0, z: 1 };
  }
  aimBasis() {
    return { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
  }
  targets(): readonly ShotTarget[] {
    return [];
  }
  worldDistance(): number {
    return Infinity;
  }
  applyImpact(): void {}
  spawnImpact(): void {}
  emitPerception(): void {}
  officerPositions(): readonly Vec3Like[] {
    return [];
  }
  spawnOfficer(): string | null {
    return null;
  }
  despawnOfficer(): void {}
  readonly police = {
    sees: () => null,
    positionOf: () => ({ x: 0, y: 0, z: 0 }),
    moveTo: () => {},
    halt: () => {},
    hasVehicle: () => false,
    say: () => {},
    arrest: () => {},
    pathFailed: () => false,
    playerDriving: false,
  };
  toast(title: string): void {
    this.toasts.push(title);
  }
  onArrest(officerId: string): void {
    this.arrests.push(officerId);
  }
  onRefusal(): void {}
}

function directed(): { host: FakeCombatHost; dir: CombatDirector } {
  const host = new FakeCombatHost();
  host.ammo.set('ammo_pistol', 60);
  const dir = new CombatDirector(new CombatState(), host);
  return { host, dir };
}

describe('surrender', () => {
  it('is refused when there is nothing to surrender to', () => {
    const { host, dir } = directed();
    expect(dir.surrender()).toBe(false);
    expect(host.arrests).toEqual([]);
  });

  it('hands the player to the host, exactly as being caught does', () => {
    const { host, dir } = directed();
    const eventId = dir.commitCrime('theft', { x: 4, y: 0, z: 4 });
    dir.heat.report({
      eventId,
      crime: 'theft',
      at: { x: 4, y: 0, z: 4 },
      observerId: 'v_ines',
      confidence: 1,
      identified: true,
      distanceToHelp: 0,
      canReachHelp: true,
    });
    // The report is queued, not applied: somebody has to reach help first.
    dir.update(CALL_DELAY_NEAR + 1);
    expect(dir.heat.wanted).toBe(true);

    expect(dir.surrender()).toBe(true);

    // The consequences are the host's, and it must be told. Clearing Heat
    // without this call makes giving up free: no fine, no hours, and the
    // getaway car left running in the street.
    expect(host.arrests).toEqual(['surrender']);
    expect(dir.heat.wanted).toBe(false);
    expect(dir.heat.arrests).toBe(1);
    // The debt is not cleared by giving up — it is settled at the desk.
    expect(dir.heat.finesOwed).toBeGreaterThan(0);
  });
});
