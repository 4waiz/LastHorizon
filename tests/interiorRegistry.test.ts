import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { InteriorRegistry, type DoorLink } from '../src/world/interiors/InteriorRegistry';
import { INTERIORS } from '../src/world/interiors/interiorCatalog';
import { KIT_PARTS } from '../src/world/interiors/InteriorKit';
import { INTERIOR_CELL_PITCH, interiorOrigin } from '../src/world/interiors/InteriorBuilder';

/**
 * A stand-in for the fetched GLB.
 *
 * Empty groups rather than meshes: the builder is being tested for its
 * placement and bookkeeping, and giving it real geometry would only make the
 * assertions about triangle counts, which the browser suite measures properly.
 */
function fakeKit(): Map<string, THREE.Object3D> {
  const kit = new Map<string, THREE.Object3D>();
  for (const part of KIT_PARTS) {
    const o = new THREE.Group();
    o.name = part;
    kit.set(part, o);
  }
  return kit;
}

const door = (id: string, interiorId: string, zone = 'village_coast'): DoorLink => ({
  id,
  zone,
  interiorId,
  position: new THREE.Vector3(10, 2, -30),
  label: 'Go inside',
});

const FROM = { x: 10, y: 2, z: -30, facing: 1.25 };

describe('interior registry', () => {
  let reg: InteriorRegistry;

  beforeEach(() => {
    reg = new InteriorRegistry();
    reg.setKit(fakeKit());
    for (const def of INTERIORS) reg.linkDoor(door(`d_${def.id}`, def.id));
  });

  it('refuses a door it does not know', () => {
    const r = reg.open({ doorId: 'nowhere', hour: 12, from: FROM });
    expect(r).toEqual({ ok: false, reason: 'unknown-door' });
  });

  it('refuses to build before the kit has arrived', () => {
    const bare = new InteriorRegistry();
    bare.linkDoor(door('d_home', 'home'));
    expect(bare.hasKit).toBe(false);
    expect(bare.open({ doorId: 'd_home', hour: 12, from: FROM })).toEqual({
      ok: false,
      reason: 'no-kit',
    });
  });

  it('opens every one of the nine', () => {
    for (const def of INTERIORS) {
      const r = reg.open({ doorId: `d_${def.id}`, hour: 12, from: FROM });
      expect(r.ok, `${def.id} at noon`).toBe(true);
      if (r.ok) {
        expect(r.interior.def.id).toBe(def.id);
        expect(r.interior.colliders.length).toBeGreaterThan(0);
      }
      reg.close();
    }
  });

  it('never has two interiors open at once', () => {
    expect(reg.open({ doorId: 'd_home', hour: 12, from: FROM }).ok).toBe(true);
    expect(reg.open({ doorId: 'd_grocery', hour: 12, from: FROM })).toEqual({
      ok: false,
      reason: 'already-open',
    });
    // And the first one is still the one that is open.
    expect(reg.active?.def.id).toBe('home');
  });

  it('gives every interior its own pocket of space', () => {
    const origins = new Set<string>();
    for (const def of INTERIORS) {
      const r = reg.open({ doorId: `d_${def.id}`, hour: 12, from: FROM });
      if (r.ok) origins.add(r.interior.origin.toArray().join(','));
      reg.close();
    }
    expect(origins.size).toBe(INTERIORS.length);
  });

  it('keeps every cell clear of the terrain and of its neighbours', () => {
    for (let i = 0; i < INTERIORS.length; i++) {
      const o = interiorOrigin(i);
      expect(o.y).toBeGreaterThan(360); // the terrain is 360 m square
      if (i > 0) {
        expect(o.distanceTo(interiorOrigin(i - 1))).toBe(INTERIOR_CELL_PITCH);
      }
    }
  });

  // -- the exact return context ---------------------------------------------

  it('remembers exactly where the player was standing', () => {
    reg.open({ doorId: 'd_home', hour: 12, from: FROM });
    expect(reg.returnContext).toEqual({
      doorId: 'd_home',
      zone: 'village_coast',
      x: 10,
      y: 2,
      z: -30,
      facing: 1.25,
    });
  });

  it('returns the player to the door they opened, not the last one linked', () => {
    const a = { x: 1, y: 2, z: 3, facing: 0.5 };
    reg.linkDoor(door('d_other', 'grocery'));
    reg.open({ doorId: 'd_grocery', hour: 12, from: a });
    const ctx = reg.close();
    expect(ctx?.doorId).toBe('d_grocery');
    expect(ctx?.x).toBe(1);
    expect(ctx?.facing).toBe(0.5);
  });

  it('clears the return context on close so it cannot be used twice', () => {
    reg.open({ doorId: 'd_home', hour: 12, from: FROM });
    expect(reg.close()).not.toBeNull();
    expect(reg.returnContext).toBeNull();
    expect(reg.close()).toBeNull();
  });

  it('survives nine enter/exit cycles without leaking a room', () => {
    for (let i = 0; i < 9; i++) {
      const def = INTERIORS[i % INTERIORS.length];
      expect(reg.open({ doorId: `d_${def.id}`, hour: 12, from: FROM }).ok).toBe(true);
      reg.close();
      expect(reg.active).toBeNull();
      expect(reg.isOpen).toBe(false);
    }
  });

  // -- hours ----------------------------------------------------------------

  it('refuses a closed shop and says when it opens', () => {
    const r = reg.open({ doorId: 'd_grocery', hour: 3, from: FROM });
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'closed') {
      expect(r.opensAt).toBe('07:00');
      expect(r.name).toBe('Village grocery');
    } else {
      throw new Error('expected a closed refusal');
    }
  });

  it('lets you into the round-the-clock services at 03:00', () => {
    for (const id of ['home', 'apartment', 'clinic', 'police']) {
      expect(reg.open({ doorId: `d_${id}`, hour: 3, from: FROM }).ok, id).toBe(true);
      reg.close();
    }
  });

  it('answers "is it open" per door', () => {
    expect(reg.isDoorOpen('d_grocery', 12)).toBe(true);
    expect(reg.isDoorOpen('d_grocery', 3)).toBe(false);
    expect(reg.isDoorOpen('d_clinic', 3)).toBe(true);
    expect(reg.isDoorOpen('nowhere', 12)).toBe(false);
  });

  it('gives back a player who saved inside a shop that has since shut', () => {
    // Being *in* a building is not the same as entering one. Refusing here
    // would strand a save with no way out.
    reg.open({ doorId: 'd_grocery', hour: 12, from: FROM });
    const ctx = reg.close()!;
    const r = reg.reopen(ctx, 3);
    expect(r.ok).toBe(true);
    expect(reg.active?.def.id).toBe('grocery');
    expect(reg.returnContext).toEqual(ctx);
  });

  // -- what the room contains ------------------------------------------------

  it('places the player inside, facing in', () => {
    const r = reg.open({ doorId: 'd_grocery', hour: 12, from: FROM });
    if (!r.ok) throw new Error('expected open');
    const { spawn, origin, spawnFacing } = r.interior;
    expect(spawn.y).toBeCloseTo(origin.y + 0.02, 6);
    expect(spawnFacing).toBeCloseTo(Math.PI, 6);
    // Room-local (2, 4) for a door on cell (1,2) south.
    expect(spawn.x - origin.x).toBeCloseTo(2, 6);
    expect(spawn.z - origin.z).toBeCloseTo(4, 6);
  });

  it('lifts every interaction point into the room cell', () => {
    const r = reg.open({ doorId: 'd_clinic', hour: 12, from: FROM });
    if (!r.ok) throw new Error('expected open');
    expect(r.interior.points.length).toBe(r.interior.def.points.length);
    for (const p of r.interior.points) {
      expect(p.world.y).toBeGreaterThan(360);
      expect(p.world.x - r.interior.origin.x).toBeCloseTo(p.x, 6);
    }
  });

  it('lifts the work points too, for the population to stand at', () => {
    const r = reg.open({ doorId: 'd_garage', hour: 12, from: FROM });
    if (!r.ok) throw new Error('expected open');
    expect(r.interior.workPoints.map((w) => w.role).sort()).toEqual(['mechanic', 'sales']);
  });

  it('places a bought decoration and leaves an empty slot empty', () => {
    const bare = reg.open({ doorId: 'd_apartment', hour: 12, from: FROM });
    if (!bare.ok) throw new Error('expected open');
    const emptyBoxes = bare.interior.stats.colliderBoxes;
    reg.close();

    const decorated = reg.open({
      doorId: 'd_apartment',
      hour: 12,
      from: FROM,
      decor: new Map([['apt_slot_a', 'KitPlanter' as const]]),
    });
    if (!decorated.ok) throw new Error('expected open');
    expect(decorated.interior.stats.colliderBoxes).toBeGreaterThan(emptyBoxes);
  });

  it('registers collision even when the kit failed to furnish the room', () => {
    // A kit that did not download must leave you in an empty room, not one
    // you can walk out of the side of.
    const empty = new InteriorRegistry();
    empty.setKit(new Map([['KitFloor', new THREE.Group()]]));
    empty.linkDoor(door('d_home', 'home'));
    const r = empty.open({ doorId: 'd_home', hour: 12, from: FROM });
    if (!r.ok) throw new Error('expected open');
    expect(r.interior.stats.parts).toBe(6); // six floor tiles, nothing else
    expect(r.interior.stats.colliderBoxes).toBeGreaterThan(20);
  });

  it('drops a zone’s links without touching another zone’s', () => {
    reg.linkDoor(door('city_a', 'cafe', 'old_market'));
    expect(reg.doorsInZone('old_market')).toHaveLength(1);
    reg.clearZone('old_market');
    expect(reg.doorsInZone('old_market')).toHaveLength(0);
    expect(reg.doorsInZone('village_coast').length).toBe(INTERIORS.length);
  });
});
